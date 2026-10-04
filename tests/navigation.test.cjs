const test=require('node:test');
const assert=require('node:assert/strict');
const {allowed,origin}=require('../client/navigation.cjs');
test('Apple authorization and NVIDIA callback work within the HTTPS allowlist',()=>{
  assert.equal(allowed('https://appleid.apple.com/auth/authorize?state=synthetic'),true);
  assert.equal(allowed('https://login.nvgs.nvidia.com/callback'),true);
  for(const url of ['http://appleid.apple.com/','https://appleid.apple.com.evil.example/',
    'https://evil.apple.com/','https://user:secret@appleid.apple.com/',
    'javascript:alert(1)','https://evilnvidia.com/']) assert.equal(allowed(url),false,url);
});
test('blocked-origin diagnostics exclude credentials, path, OAuth state and tokens',()=>{
  assert.equal(origin('https://user:secret@example.com/callback?code=secret&state=private#token'), 'https://example.com');
  assert.equal(origin('invalid'),'invalid');
});
