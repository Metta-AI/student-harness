"""Idempotently restart the worker process after the VM resumes."""
import json, os, socket, subprocess
from pathlib import Path
root=Path('/workspace/audit');config=json.loads((root/'session.json').read_text())
try:
    with socket.create_connection(('127.0.0.1',8097),timeout=1):pass
except OSError:
    env=dict(os.environ,PRESTON_AUDIT_WORKER_KEY=config['key'],PRESTON_AUDIT_DATA=str(root/'jobs'),PRESTON_AUDIT_ENGINES=str(root/'engines.json'),PRESTON_AUDIT_BIND='0.0.0.0',PORT='8097',PRESTON_AUDIT_CONCURRENCY=os.environ.get('PRESTON_AUDIT_CONCURRENCY','4'))
    with open(root/'worker.log','ab') as log:subprocess.Popen(['python3',str(root/'replay_audit.py')],env=env,stdout=log,stderr=log,start_new_session=True)
