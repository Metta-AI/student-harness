"""Describe verified archive byte ranges; never extract or execute its contents."""
import base64
import json
import sys
import tarfile
from inspect_oci import inspect


def layout(path):
    with tarfile.open(path, 'r:') as archive:
        if any(item.sparse is not None for item in archive):
            raise ValueError('Sparse archive members do not have contiguous upload ranges')
        image = inspect(path)
        manifest_path = 'blobs/sha256/' + image['manifestDigest'].split(':')[1]
        manifest_bytes = archive.extractfile(manifest_path).read()
        manifest = json.loads(manifest_bytes)
        blobs = []
        seen = set()
        for descriptor in [*manifest['layers'], manifest['config']]:
            digest = descriptor['digest']
            if digest in seen:
                continue
            seen.add(digest)
            item = archive.getmember('blobs/sha256/' + digest.split(':')[1])
            blobs.append({'digest': digest, 'bytes': item.size, 'offset': item.offset_data})
        return {'image': image, 'manifest': base64.b64encode(manifest_bytes).decode(),
                'mediaType': manifest['mediaType'], 'blobs': blobs}


if __name__ == '__main__':
    print(json.dumps(layout(sys.argv[1])))
