// Ordered binary KeyValues. Preserve untouched entries (including raw scalar
// bytes); reject unsupported/truncated files before writing. Format reference:
// https://github.com/ValvePython/vdf/blob/master/vdf/__init__.py
const {TextDecoder}=require('node:util');
const utf8=new TextDecoder('utf-8',{fatal:true});
function decode(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>16*1024*1024) throw new Error('Invalid/oversized Steam VDF');
  let at=0,count=0;
  function take(n){if(at+n>bytes.length) throw new Error('Truncated Steam VDF');const b=bytes.subarray(at,at+n);at+=n;return b;}
  function string(){const end=bytes.indexOf(0,at);if(end<0) throw new Error('Unterminated Steam VDF string');const value=utf8.decode(bytes.subarray(at,end));at=end+1;return value;}
  function object(depth){
    if(depth>16) throw new Error('Steam VDF nesting limit');
    const entries=[];
    for(;;){
      const type=take(1)[0];
      if(type===8) return entries;
      if(++count>100000) throw new Error('Steam VDF entry limit');
      const key=string();let value;
      if(type===0) value=object(depth+1);
      else if(type===1) value=string();
      else if([2,3,4,6].includes(type)) value=Buffer.from(take(4));
      else if([7,10].includes(type)) value=Buffer.from(take(8));
      else throw new Error(`Unsupported Steam VDF type ${type}; original file retained`);
      entries.push({type,key,value});
    }
  }
  const result=object(0);if(at!==bytes.length) throw new Error('Trailing Steam VDF data');return result;
}
function encode(entries){
  function string(value){if(typeof value!=='string'||value.includes('\0')) throw new Error('Invalid VDF string');return Buffer.from(value+'\0');}
  const chunks=[];
  function object(rows){for(const row of rows){chunks.push(Buffer.from([row.type]),string(row.key));if(row.type===0)object(row.value);else if(row.type===1)chunks.push(string(row.value));else chunks.push(row.value);}chunks.push(Buffer.from([8]));}
  object(entries);return Buffer.concat(chunks);
}
function get(rows,key){const fields=rows.filter(r=>r.key===key);if(fields.length>1) throw new Error(`Duplicate Steam field ${key}`);return fields[0];}
function set(rows,key,type,value){const entry=get(rows,key);if(entry){entry.type=type;entry.value=value;}else rows.push({key,type,value});}
function uint32(value){const b=Buffer.alloc(4);b.writeUInt32LE(value>>>0);return b;}
module.exports={decode,encode,get,set,uint32};
