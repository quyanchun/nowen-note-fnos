"""Isolated HTTP acceptance; refuses non-loopback targets and never prints credentials."""
import http.cookiejar,json,sys,urllib.request,urllib.error,urllib.parse
web=sys.argv[1].rstrip('/') if len(sys.argv)>1 else 'http://127.0.0.1:34981'
portal=sys.argv[2].rstrip('/') if len(sys.argv)>2 else 'http://127.0.0.1:34982'
for target in [web,portal]:
 assert urllib.parse.urlsplit(target).hostname in ['127.0.0.1','localhost'], 'Isolated loopback targets only'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),NoRedirect())
checks=[]
def request(path,body=None,token=None,base=web,extra=None,method=None):
 headers={'Accept':'application/json'}
 if body is not None:headers.update({'Content-Type':'application/json','Origin':web})
 if token:headers['Authorization']='Bearer '+token
 headers.update(extra or {})
 req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
 try:response=client.open(req,timeout=10)
 except urllib.error.HTTPError as error:response=error
 payload=response.read();content=response.headers.get('Content-Type','')
 return response.status,response.headers,json.loads(payload) if 'application/json' in content else None

def check(name,value):
 assert value,name
 checks.append(name)
def login():
 status,headers,attempt=request('/api/auth/web/start',{'flow':'callback'})
 check('callback start accepted',status==200 and bool(attempt.get('authorizeUrl')))
 status,_,result=request('/api/auth/web/poll',attempt)
 check('no session before callback',status==200 and result['status']=='waiting')
 authorize=urllib.parse.urlsplit(attempt['authorizeUrl'])
 status,headers,_=request(authorize.path+'?'+authorize.query,base=portal,extra={'Cookie':'nowen_cross_mock_20261028=ok'})
 check('private gateway creates redirect code',status==302)
 callback=urllib.parse.urlsplit(headers['Location'])
 check('callback fixed to configured web origin',callback.scheme+'://'+callback.netloc==web)
 status,_,_=request(callback.path+'?'+callback.query)
 check('bound browser redeems one-time code',status==200)
 status,_,result=request('/api/auth/web/poll',attempt)
 check('approved poll returns NAS account',status==200 and result['status']=='connected' and bool(result['login']['user']['id']))
 status,_,_=request('/api/auth/web/poll',attempt)
 check('poll cannot be replayed',status==410)
 return result['login']
status,_,options=request('/api/auth/web/options?origin='+urllib.parse.quote(web,safe=''))
check('configured origin enabled',status==200 and options.get('enabled') and options['portalOrigin']==portal)
first=login();second=login()
check('repeated login uses existing NAS account',first['user']['id']==second['user']['id'])
status,_,_=request('/api/auth/web/authorize?requestId='+'x'*43,extra={'X-Trim-Userid':'9000','X-Trim-Username':'forged','X-Trim-Isadmin':'true'})
check('public TCP listener rejects forged NAS identity',status==401)
status,_,settings=request('/api/settings/fnos-web-login',token=first['token'])
check('administrator can read configuration',status==200 and isinstance(settings['entries'],list))
status,_,_=request('/api/settings/fnos-web-login',{'entries':[{'name':'bad','webOrigin':web,'portalOrigin':'https://name:password@nas.test'}]},first['token'],method='PUT')
check('invalid configuration rejected',status==400)
status,_,after=request('/api/settings/fnos-web-login',token=first['token'])
check('rejected update preserves previous configuration',status==200 and after['entries']==settings['entries'])
status,_,_=request('/api/auth/logout',{},second['token'])
check('new web session can log out',status==200)
status,_,_=request('/api/auth/verify',token=first['token'])
check('another established session remains valid',status==200)
request('/api/auth/logout',{},first['token'])
print(json.dumps({'environment':'isolated loopback HTTP','passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))
