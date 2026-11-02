"""Validate generated public fnOS templates without requiring an installed NAS."""
import json,os,subprocess,sys,tarfile,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
class FnosPublicPackage(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.folder=Path(self.tmp.name)
  self.fnpack=self.folder/'fnpack';self.fnpack.write_text('#!'+sys.executable+'\nimport pathlib,sys,tarfile\np=pathlib.Path(sys.argv[sys.argv.index("--directory")+1])\nwith tarfile.open("fixture.fpk","w:gz") as t:t.add(p,arcname="package")\n');self.fnpack.chmod(0o755)
 def build(self,*args):
  out=self.folder/'out';result=subprocess.run([sys.executable,str(ROOT/'scripts/fpk/build-private-fpk.py'),'--fnpack',str(self.fnpack),'--out',str(out),*args],text=True,capture_output=True)
  return result,out
 def rendered(self,*args):
  result,out=self.build(*args);self.assertEqual(result.returncode,0,result.stderr)
  with tarfile.open(next(out.glob('*.fpk'))) as t:return {name:t.extractfile('package/'+name).read().decode() for name in ['app/docker/docker-compose.yaml','manifest','app/ui/config','cmd/main']}
 def test_public_defaults_are_loopback_and_have_no_shared_origins(self):
  files=self.rendered();compose=files['app/docker/docker-compose.yaml'];self.assertIn('127.0.0.1:3504:3001',compose);self.assertIn('127.0.0.1:3502:3001',compose);self.assertIn('local/nowen-note-fnos:1.5.4',compose)
  for field in ['NOWEN_WEB_PUBLIC_URL','NOWEN_FNOS_PORTAL_URL','NOWEN_CLIPBOARD_PUBLIC_URL']:self.assertIn(field+': ""',compose)
  self.assertNotIn('NOWEN_CLIPBOARD_PORT',compose);self.assertNotIn('{{',''.join(files.values()));self.assertIn('version = 1.5.4',files['manifest']);json.loads(files['app/ui/config'])
 def test_explicit_deployment_options_render_only_supplied_origins(self):
  files=self.rendered('--web-bind','192.0.2.10','--web-port','4504','--web-origin','https://notes.example.test','--portal-origin','https://nas.example.test')
  compose=files['app/docker/docker-compose.yaml'];self.assertIn('192.0.2.10:4504:3001',compose);self.assertIn('https://notes.example.test/api/clipboard/captures',compose);self.assertIn('https://nas.example.test',compose)
 def test_rejects_credential_or_path_bearing_origins(self):
  for origin in ['https://user:secret@notes.example.test','https://notes.example.test/path','https://notes.example.test?token=fixture','javascript:example']:
   result,_=self.build('--web-origin',origin,'--portal-origin','https://nas.example.test');self.assertNotEqual(result.returncode,0)
 def test_rejects_partial_origin_and_port_conflict(self):
  for args in [('--web-origin','https://notes.example.test'),('--web-port','3502'),('--web-bind','host.example.test')]:self.assertNotEqual(self.build(*args)[0].returncode,0)
if __name__=='__main__':unittest.main()
