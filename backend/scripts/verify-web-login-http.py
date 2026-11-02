#!/usr/bin/env python3
"""Exercise a disposable local web entry and its mock fnOS portal; never targets production."""
import argparse
import http.cookiejar
import json
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--web', required=True)
parser.add_argument('--portal', required=True)
parser.add_argument('--report', required=True)
parser.add_argument('--fixture')
args = parser.parse_args()
for address in [args.web, args.portal]:
    if urllib.parse.urlsplit(address).hostname not in ['127.0.0.1', 'localhost']:
        parser.error('Only isolated loopback services with a mock NAS portal are allowed')
web, portal = args.web.rstrip('/'), args.portal.rstrip('/')
browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
other = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
checks = []


def request(url, method='GET', body=None, token=None, client=browser, origin=None, headers=None):
    supplied = dict(headers or {})
    if method != 'GET':
        parts = urllib.parse.urlsplit(url)
        supplied['Origin'] = origin or f'{parts.scheme}://{parts.netloc}'
    if token:
        supplied['Authorization'] = 'Bearer ' + token
    if body is not None:
        supplied['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, method=method, headers=supplied, data=json.dumps(body).encode() if body is not None else None)
    try:
        response = client.open(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read().decode()
    try:
        data = json.loads(raw)
    except ValueError:
        data = raw
    return response.status, data


def check(label, assertion):
    assert assertion, label
    checks.append({'label': label, 'passed': True})


status, body = request(web + '/')
check('新网页不依赖飞牛会话即可加载登录页面', status == 200 and '<html' in body.lower() and body != 'invalid token')
check('匿名和伪造NAS身份都不能访问笔记', request(web + '/api/notes')[0] == 401 and request(web + '/api/notes', headers={'X-Trim-Userid': '1000', 'X-Trim-Username': 'forged', 'X-Trim-Isadmin': 'true'})[0] == 401)
check('固定配置启用NAS登录且不接受外部回跳', request(web + '/api/auth/web/options')[1]['webOrigin'] == web)
username, password = 'web_test_' + secrets.token_hex(4), secrets.token_urlsafe(20)
status, registered = request(web + '/api/auth/register', 'POST', {'username': username, 'password': password})
check('隔离独立账号通过标准注册接口创建', status in [200, 201] and bool(registered.get('user', {}).get('id')))
check('错误密码无法登录', request(web + '/api/auth/login', 'POST', {'username': username, 'password': password + 'wrong'})[0] == 401)
status, login = request(web + '/api/auth/login', 'POST', {'username': username, 'password': password})
check('账号密码登录和个人身份查询成功', status == 200 and request(web + '/api/me', token=login['token'])[1]['id'] == registered['user']['id'])
status, refreshed = request(web + '/api/auth/refresh', 'POST', {'refreshToken': login['refreshToken']})
check('登录续期保持同一账号', status == 200 and request(web + '/api/me', token=refreshed['token'])[1]['id'] == registered['user']['id'])
request(web + '/api/auth/logout', 'POST', {}, token=refreshed['token'])
check('注销后旧访问令牌立即失效', request(web + '/api/me', token=refreshed['token'])[0] == 401)
check('跨站不能发起网页登录', request(web + '/api/auth/web/start', 'POST', {}, origin='http://evil.test')[0] == 403)
status, pending = request(web + '/api/auth/web/start', 'POST', {})
check('等待NAS登录时不签发笔记令牌', status == 200 and request(web + '/api/auth/web/poll', 'POST', pending)[1] == {'status': 'waiting'} and pending['proof'] not in pending['portalUrl'])
check('其他浏览器不能领取授权', request(web + '/api/auth/web/poll', 'POST', pending, client=other)[0] == 410)
check('未登录旧网关仍保持飞牛认证', request(portal + '/app/nowen-note-private/api/health', client=other)[1] == 'invalid token')
check('只使用飞牛原登录页，无额外应用授权页', pending['portalUrl'] == portal + '/' and request(pending['portalUrl'])[0] == 200)
request(portal + '/mock-login', 'POST', {})
import time
time.sleep(1.1)
status, result = request(web + '/api/auth/web/poll', 'POST', pending)
check('飞牛登录后自动返回，无二次确认', status == 200 and result.get('status') == 'connected')
nas = result['login']
check('NAS登录进入对应账号，与独立账号隔离', status == 200 and result['status'] == 'connected' and nas['user']['id'] != registered['user']['id'] and request(web + '/api/me', token=nas['token'])[1]['id'] == nas['user']['id'])
check('领取后的授权不可重放', request(web + '/api/auth/web/poll', 'POST', pending)[0] == 410)
_, pending2 = request(web + '/api/auth/web/start', 'POST', {})
request(web + '/api/auth/web/cancel', 'POST', pending2)
check('取消后不能继续登录', request(web + '/api/auth/web/poll', 'POST', pending2)[0] == 410)
request(web + '/api/auth/logout', 'POST', {}, token=nas['token'])
check('NAS网页登录注销不依赖飞牛Cookie', request(web + '/api/me', token=nas['token'])[0] == 401)
report = {'passed': True, 'web': web, 'portal': portal, 'checks': checks}
with open(args.report, 'w') as output:
    json.dump(report, output, ensure_ascii=False, indent=2)
if args.fixture:
    fd = os.open(args.fixture, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump({'username': username, 'password': password, 'userId': registered['user']['id']}, output)
print(json.dumps({'passed': True, 'checks': len(checks)}, ensure_ascii=False))
