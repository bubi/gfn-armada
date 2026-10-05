const test=require('node:test'),assert=require('node:assert/strict');
const {identity,requestHeaders}=require('../client/browser-identity.cjs');
test('browser identity is opt-in, bounded and uses the actual Chromium version',()=>{
  assert.equal(identity({chrome:'152.0.7977.130'}),null);
  assert.throws(()=>identity({mode:'arbitrary',chrome:'152.0.7977.130'}));
  assert.throws(()=>identity({mode:'windows',chrome:'152\r\n'}));
  for(const mode of ['linux','windows','macos','chromeos']){
    const id=identity({mode,chrome:'152.0.7977.130',arch:'arm64'});
    assert.ok(id.userAgent.includes('Chrome/152.0.7977.130'));assert.equal(id.hints.architecture,'arm');
  }
});
test('GFN header emulation matches JS hints, preserves credentials and leaves capability APIs alone',()=>{
  const id=identity({mode:'windows',chrome:'152.0.7977.130',arch:'arm64'});
  const original={'User-Agent':'Linux','sec-ch-ua-platform':'"Linux"','Sec-CH-UA-Arch':'"arm"','Cookie':'synthetic','Authorization':'synthetic'};
  const result=requestHeaders(original,id);
  assert.equal(result['sec-ch-ua-platform'],'"Windows"');assert.equal(result['Sec-CH-UA-Arch'],'"arm"');
  assert.equal(result.Cookie,'synthetic');assert.equal(result.Authorization,'synthetic');
  assert.equal(original['User-Agent'],'Linux');assert.ok(!result['User-Agent'].includes('Linux'));
  assert.equal(Object.keys(result).filter(k=>k.toLowerCase()==='user-agent').length,1);
  assert.equal(result['Sec-CH-UA-Mobile'],'?0');
});
