"""Validate an OCI archive without extracting paths or loading a container."""
import gzip
import hashlib
import json
import sys
import tarfile

MAX_JSON = 2_000_000

def inspect(path):
    with tarfile.open(path, 'r:') as archive:
        members = {}
        for item in archive:
            if item.name in members:
                raise ValueError('Duplicate archive entry')
            if len(members) >= 10000:
                raise ValueError('Too many archive entries')
            if not item.isfile() and not item.isdir():
                raise ValueError('Archive links are not supported')
            members[item.name] = item

        def read(name, expected_size=None, expected_digest=None, as_json=False):
            item = members.get(name)
            if item is None or not item.isfile():
                raise ValueError('Missing OCI archive member')
            if expected_size is not None and item.size != expected_size:
                raise ValueError('OCI descriptor size mismatch')
            if as_json and item.size > MAX_JSON:
                raise ValueError('OCI metadata is too large')
            digest = hashlib.sha256()
            body = bytearray()
            with archive.extractfile(item) as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
                    if as_json:
                        body.extend(chunk)
            if expected_digest is not None and 'sha256:' + digest.hexdigest() != expected_digest:
                raise ValueError('OCI descriptor digest mismatch')
            return json.loads(body) if as_json else None

        def descriptor(entry, as_json=False):
            digest = entry.get('digest', '')
            value = digest.removeprefix('sha256:')
            if len(value) != 64 or any(c not in '0123456789abcdef' for c in value) or not digest.startswith('sha256:'):
                raise ValueError('Unsupported OCI digest')
            if not isinstance(entry.get('size'), int) or entry['size'] < 0:
                raise ValueError('Invalid OCI descriptor size')
            return read('blobs/sha256/' + value, entry['size'], digest, as_json)

        if read('oci-layout', as_json=True).get('imageLayoutVersion') != '1.0.0':
            raise ValueError('Unsupported OCI layout')
        index = read('index.json', as_json=True)
        entries = index.get('manifests', [])
        if index.get('schemaVersion') != 2 or len(entries) != 1:
            raise ValueError('Expected one OCI image')
        entry = entries[0]
        manifest = descriptor(entry, True)
        if manifest.get('schemaVersion') != 2 or manifest.get('mediaType') != 'application/vnd.oci.image.manifest.v1+json':
            raise ValueError('Expected an OCI image manifest')
        config = descriptor(manifest['config'], True)
        if (config.get('os'), config.get('architecture')) != ('linux', 'amd64'):
            raise ValueError('Expected linux/amd64 policy image')
        layers = manifest.get('layers', [])
        if len(layers) > 256:
            raise ValueError('Too many image layers')
        rootfs = config.get('rootfs', {})
        if rootfs.get('type') != 'layers' or len(rootfs.get('diff_ids', [])) != len(layers):
            raise ValueError('OCI root filesystem identity mismatch')
        for layer, diff_id in zip(layers, rootfs['diff_ids']):
            descriptor(layer)
            member = members['blobs/sha256/' + layer['digest'].removeprefix('sha256:')]
            with archive.extractfile(member) as compressed:
                media = layer.get('mediaType')
                if media == 'application/vnd.oci.image.layer.v1.tar+gzip':
                    uncompressed = gzip.GzipFile(fileobj=compressed)
                elif media == 'application/vnd.oci.image.layer.v1.tar':
                    uncompressed = compressed
                else:
                    raise ValueError('Unsupported OCI layer encoding')
                digest = hashlib.sha256()
                decoded_bytes = 0
                while chunk := uncompressed.read(1024 * 1024):
                    decoded_bytes += len(chunk)
                    if decoded_bytes > 4_000_000_000:
                        raise ValueError('Expanded layer is too large')
                    digest.update(chunk)
                if 'sha256:' + digest.hexdigest() != diff_id:
                    raise ValueError('OCI expanded layer identity mismatch')
        return {'manifestDigest': entry['digest'], 'configDigest': manifest['config']['digest'],
                'platform': 'linux/amd64', 'layers': len(layers),
                'imageBytes': sum(layer['size'] for layer in layers) + manifest['config']['size'],
                'entrypoint': config.get('config', {}).get('Entrypoint'), 'command': config.get('config', {}).get('Cmd')}

if __name__ == '__main__':
    try:
        print(json.dumps(inspect(sys.argv[1]), separators=(',', ':')))
    except Exception as error:
        # No archive contents or source text in failure output.
        print(json.dumps({'error': type(error).__name__, 'message': str(error) if isinstance(error, ValueError) else 'Invalid OCI archive'}), file=sys.stderr)
        sys.exit(1)
