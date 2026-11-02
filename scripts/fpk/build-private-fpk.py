#!/usr/bin/env python3
"""Package the private fnOS desktop entry; no registry login or upload is performed."""
import argparse,ipaddress,json,os,re,shutil,subprocess,tempfile
from urllib.parse import urlsplit
from pathlib import Path

root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fnpack',default=os.environ.get('FNPACK_BIN','fnpack'))
parser.add_argument('--image',default=None)
parser.add_argument('--port',type=int,default=3502)
parser.add_argument('--revision',type=int,default=0,help='fnOS packaging revision')
parser.add_argument('--out',type=Path,default=root/'dist-fpk-private')
parser.add_argument('--web-bind',default='127.0.0.1',help='Bind optional web/API entry to this NAS IP; loopback by default')
parser.add_argument('--web-port',type=int,default=3504)
parser.add_argument('--web-origin',default='',help='Optional independent web origin, without credentials or path')
parser.add_argument('--portal-origin',default='',help='Matching fnOS portal origin, without credentials or path')
args=parser.parse_args()
version=json.loads((root/'package.json').read_text())['version']
args.image=args.image or f'local/nowen-note-fnos:{version}'
try:
    if ipaddress.ip_address(args.web_bind).version != 4:raise ValueError()
except ValueError:parser.error('web-bind must be an IPv4 address')
if not 1024 <= args.web_port <= 65535 or args.web_port==args.port:parser.error('web-port must be 1024..65535 and differ from port')
for value in [args.web_origin,args.portal_origin]:
    if not value:continue
    u=urlsplit(value)
    if u.scheme not in ['http','https'] or not u.hostname or u.username or u.password or u.path not in ['', '/'] or u.query or u.fragment:parser.error('web-origin and portal-origin must be credential-free HTTP/HTTPS root origins')
if bool(args.web_origin)!=bool(args.portal_origin):parser.error('web-origin and portal-origin must be configured together')
if not 1024 <= args.port <= 65535:parser.error('port must be between 1024 and 65535')
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/@-]*',args.image):parser.error('invalid image reference')
version=json.loads((root/'package.json').read_text())['version']
if not re.fullmatch(r'\d+\.\d+\.\d+',version):parser.error('fnOS package requires a numeric X.Y.Z version')
if not 0 <= args.revision <= 999:parser.error('revision must be between 0 and 999')
if args.revision:version += '-' + str(args.revision)
fnpack=shutil.which(args.fnpack)
if not fnpack:parser.error('fnpack not found; download the official tool or supply --fnpack')
out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='nowen-fnos-private-') as tmp:
    package=Path(tmp)/'nowen-note-private'
    shutil.copytree(root/'deploy/fnos-private/package',package,ignore=shutil.ignore_patterns('.DS_Store','.gitkeep'))
    (package/'wizard').mkdir(exist_ok=True)
    for rel in ['manifest','app/docker/docker-compose.yaml','app/ui/config','cmd/main']:
        p=package/rel;s=p.read_text()
        for key,value in {'VERSION':version,'IMAGE':args.image,'PORT':str(args.port),'WEB_BIND':args.web_bind,'WEB_PORT':str(args.web_port),
                          'WEB_PUBLIC_URL':json.dumps(args.web_origin.rstrip('/')),'PORTAL_URL':json.dumps(args.portal_origin.rstrip('/')),
                          'CLIPBOARD_PUBLIC_URL':json.dumps(args.web_origin.rstrip('/')+'/api/clipboard/captures' if args.web_origin else '')}.items():s=s.replace('{{'+key+'}}',value)
        p.write_text(s)
    for rel in ['config/resource','config/privilege','app/ui/config']:json.loads((package/rel).read_text())
    shutil.copyfile(package/'app/ui/images/icon_64.png',package/'ICON.PNG')
    shutil.copyfile(package/'app/ui/images/icon_256.png',package/'ICON_256.PNG')
    for p in (package/'cmd').iterdir():p.chmod(0o755)
    subprocess.run([fnpack,'build','--directory',str(package)],cwd=tmp,check=True)
    files=list(Path(tmp).rglob('*.fpk'))
    if len(files)!=1:raise RuntimeError('Expected exactly one generated .fpk file')
    destination=out/f'nowen-note-private-{version}.fpk'
    shutil.copyfile(files[0],destination)
    print(destination)
print('Install the matching local Docker image on the NAS before installing this FPK.')
