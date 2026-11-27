import assert from "node:assert/strict";
import test from "node:test";
import {clipboardQualityFilter,clipboardCredentials,canonicalClipboardFolder} from "../src/services/clipboard-quality";

test("unattended capture rejects credentials without an evidenced service",()=>{
  for(const text of ["账号：admin\n密码：Synthetic-42!","密码：Synthetic-42!","Synthetic-42!","admin","onlyletters","admin\nSynthetic-42!","123456","user@example.test","sk-synthetic-0123456789abcdef"]) {
    assert.deepEqual(clipboardQualityFilter(text),{code:"CAPTURE_CONTEXT_REQUIRED",sensitive:true},text);
  }
  // An email domain identifies an account, not the service it logs into.
  assert.equal(clipboardCredentials("账号：me@example.test\n密码：Synthetic-42!")?.service,null);
  assert.equal(clipboardCredentials("账号：admin\n密码：secret.example.test")?.service,null);
  for(const text of ["服务：演示平台\n账号：admin\n密码：Synthetic-42!","https://demo.example.test\n账号：admin\n密码：Synthetic-42!","地址：192.0.2.2:8080\n用户名：admin\n密码：Synthetic-42!"]) {
    assert.ok(clipboardCredentials(text)?.service,text);
    assert.equal(clipboardQualityFilter(text),null,text);
  }
});

test("clipboard noise is rejected while reusable SQL, config and conclusions survive",()=>{
  for(const text of ["你帮我看一下这个界面，然后改好它。","https://example.test/doc","/tmp/capture-123.txt","2026-11-16 10:00:00 INFO starting\n2026-11-16 10:00:01 ERROR failed"]) {
    assert.equal(clipboardQualityFilter(text)?.code,"CAPTURE_LOW_VALUE",text);
  }
  for(const text of ["SELECT id FROM users WHERE enabled = 1;","CREATE TABLE accounts (username TEXT, password TEXT);","原因：连接池耗尽。解决方法：限制并发到20并设置超时。","server { listen 8080; proxy_pass http://127.0.0.1:3001; }"]) assert.equal(clipboardQualityFilter(text),null,text);
  assert.equal(clipboardCredentials("CREATE TABLE accounts (username TEXT, password TEXT);"),null);
});

test("automatic folders use canonical names instead of generating synonymous categories",()=>{
  for(const [name,expected] of [["技术学习","技术"],["软件开发","技术"],["工作笔记","工作"],["AI与机器学习","AI"],["人工智能","AI"],["数据库","数据库"]]) assert.equal(canonicalClipboardFolder(name),expected);
});
