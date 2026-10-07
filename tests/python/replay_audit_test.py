"""Worker contract test using fake executables; never runs a game or native replay."""
import gzip, base64, hashlib, importlib.util, json, os, sys, tempfile, threading, time, unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

class WorkerContract(unittest.TestCase):
    def test_persistent_identity_auth_and_pinned_engines(self):
        with tempfile.TemporaryDirectory() as root:
            os.environ['PRESTON_AUDIT_DATA'] = root
            spec = importlib.util.spec_from_file_location('worker', Path(__file__).parents[2]/'workers/replay_audit.py')
            worker = importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
            worker.KEY = 'unit-test-only'; worker.REGISTRY = Path(root)/'engines.json'
            server = worker.ThreadingHTTPServer(('127.0.0.1',0), worker.Handler)
            thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base=f'http://127.0.0.1:{server.server_port}'
            def request(path,body=None,auth=True):
                headers={'Content-Type':'application/json'}
                if auth: headers['Authorization']='Bearer unit-test-only'
                with urlopen(Request(base+path,data=json.dumps(body).encode() if body else None,headers=headers),timeout=3) as r:return json.load(r)
            try:
                with self.assertRaises(HTTPError) as err: request('/engines/release',auth=False)
                self.assertEqual(err.exception.code,401)
                self.assertFalse(request('/engines/release')['ready'])
                identity={'release':'release','replay':worker.digest(b'tape'),'source':worker.digest(b'10 END'),'slot':0}
                job=worker.digest(json.dumps(identity,sort_keys=True,separators=(',',':')).encode())
                payload={'jobId':job,'episodeId':'ereq-test','release':{'fingerprint':'release','sourceUrl':'pinned-source'},'replay':base64.b64encode(b'tape').decode(),'source':'10 END','slot':0}
                request('/jobs',payload)
                def wait(status):
                    for _ in range(100):
                        result=request('/jobs/'+job)
                        if result['status']==status:return result
                        time.sleep(.02)
                    self.fail(f'Worker did not reach {status}: {result}')
                wait('waiting')
                config={'sourceUrl':'pinned-source'}
                for name,output in [('replayBinary',{'ticks':3,'hash_mismatches':0}),('vmBinary',{'validated_hashes':3})]:
                    binary=Path(root)/name
                    binary.write_text(f'#!{sys.executable}\nprint({json.dumps(json.dumps(output))})\n');binary.chmod(0o700)
                    config[name]=str(binary);config[name+'Sha256']=worker.digest(binary.read_bytes())
                worker.REGISTRY.write_text(json.dumps({'release':config}))
                self.assertTrue(request('/engines/release')['ready'])
                compiler=Path(root)/'compiler'
                compiler.write_text(f'#!{sys.executable}\nimport os,json\nfrom pathlib import Path\ns=Path(os.environ["AUDIT_SOURCE"]).read_text()\nprint(json.dumps({{"valid":s=="10 END","error":"global limit" if s!="10 END" else ""}}))\n');compiler.chmod(0o700)
                config['validatorBinary']=str(compiler);config['validatorBinarySha256']=worker.digest(compiler.read_bytes())
                worker.REGISTRY.write_text(json.dumps({'release':config}))
                valid=request('/validate',{'release':payload['release'],'source':'10 END'})
                self.assertTrue(valid['valid']);self.assertEqual(valid['sourceHash'],identity['source'])
                self.assertFalse(request('/validate',{'release':payload['release'],'source':'invalid'})['valid'])
                with self.assertRaises(HTTPError) as err:request('/validate',{'release':{'fingerprint':'other','sourceUrl':'other'},'source':'10 END'})
                self.assertEqual(err.exception.code,409)
                # A persisted waiting job resumes when a compatible engine becomes available.
                completed=wait('completed');self.assertEqual(completed['result']['vm']['source_hash'],identity['source'])
                self.assertEqual(request('/jobs',payload)['status'],'completed')
                compressed={**payload,'replayEncoding':'gzip','replay':base64.b64encode(gzip.compress(b'tape')).decode()}
                self.assertEqual(request('/jobs',compressed)['status'],'completed')
                self.assertEqual(len(list(Path(root).glob('*/input.json'))),1)
                for invalid in [b'not gzip',gzip.compress(b'tape')[:-2]]:
                    with self.assertRaises(HTTPError) as err:request('/jobs',{**compressed,'replay':base64.b64encode(invalid).decode()})
                    self.assertEqual(err.exception.code,400)
                # Decoder enrichment reuses immutable inputs and archives the original receipt.
                binary=Path(config['replayBinary'])
                binary.write_text(f'#!{sys.executable}\nprint({json.dumps(json.dumps({"ticks":3,"hash_mismatches":0,"semantics":{"ticks_per_second":24}}))})\n')
                config['replayBinarySha256']=worker.digest(binary.read_bytes())
                worker.REGISTRY.write_text(json.dumps({'release':config}))
                enriched=wait('completed')
                self.assertEqual(enriched['result']['simulation']['semantics']['ticks_per_second'],24)
                self.assertEqual(len(list((Path(root)/job/'receipts').glob('*.json'))),1)
                self.assertEqual(len(list(Path(root).glob('*/input.json'))),1)
                # Probes have a separate identity and never yield a full VM verification receipt.
                probe=Path(root)/'probe'
                diagnostics={'events':[{'tick':1,'battle_tick':0,'kind':'ValuePrint','value':17}], 'event_count':1,'truncated':False}
                probe.write_text(f'#!{sys.executable}\nprint({json.dumps(json.dumps({"validated_hashes":1,"subject":0,"first_divergence_tick":2,"diagnostic_output":diagnostics}))})\n');probe.chmod(0o700)
                config['probeBinary']=str(probe);config['probeBinarySha256']=worker.digest(probe.read_bytes())
                worker.REGISTRY.write_text(json.dumps({'release':config}))
                probe_identity={**identity,'mode':'candidate-prefix-probe'}
                probe_job=worker.digest(json.dumps(probe_identity,sort_keys=True,separators=(',',':')).encode())
                self.assertNotEqual(job,probe_job)
                request('/jobs',{**payload,'jobId':probe_job,'mode':'candidate-prefix-probe'})
                original_job=job;job=probe_job
                result=wait('completed')['result']
                self.assertEqual(result['kind'],'candidate-prefix-probe')
                self.assertEqual(result['probe']['first_divergence_tick'],2)
                self.assertEqual(result['probe']['diagnostic_output'],diagnostics)
                self.assertNotIn('vm',result);self.assertNotIn('simulation',result)
                self.assertEqual(result['sourceHash'],identity['source'])
                # Missing/invalid divergence information cannot masquerade as a full prefix.
                probe.write_text(f'#!{sys.executable}\nprint({json.dumps(json.dumps({"validated_hashes":1,"subject":0,"first_divergence_tick":3}))})\n')
                config['probeBinarySha256']=worker.digest(probe.read_bytes());worker.REGISTRY.write_text(json.dumps({'release':config}))
                self.assertIn('Invalid candidate prefix receipt',wait('failed')['error'])
                job=original_job
                self.assertEqual(request('/jobs/'+job)['result']['vm']['validated_hashes'],3)
                with self.assertRaises(HTTPError) as err:request('/jobs',{**payload,'mode':'unknown'})
                self.assertEqual(err.exception.code,400)
                # Corrupting a binary makes the preflight fail before further games are requested.
                Path(config['vmBinary']).write_text('changed')
                self.assertFalse(request('/engines/release')['ready'])
                with self.assertRaises(HTTPError) as err:request('/jobs',{**payload,'source':'different'})
                self.assertEqual(err.exception.code,400)
            finally:
                server.shutdown();server.server_close();thread.join();worker.POOL.shutdown(wait=True)

if __name__=='__main__':unittest.main()
