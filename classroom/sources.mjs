import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const worker=fileURLToPath(new URL('./source-worker.mjs',import.meta.url))
export const MAX_UPLOAD=8*1024*1024
const invalid=(message,status=400)=>Object.assign(new Error(message),{status})
export function uploadMetadata(params) {
  const filename=params.get('filename')||'',title=params.get('title')||'',publisher=params.get('publisher')||''
// eslint-disable-next-line no-control-regex -- Strip/reject binary control characters in document input.
  if(!filename || filename.length>240 || /[/\\\x00-\x1f]/.test(filename))throw invalid('Choose a file with a simple filename of at most 240 characters.')
  if(!title.trim()||title.length>160||publisher.length>160)throw invalid('Enter a source title (up to 160 characters) and optional publisher.')
  const format=filename.split('.').pop().toLowerCase()
  if(!['pdf','docx','txt','md'].includes(format))throw invalid('Upload PDF, DOCX, TXT or Markdown files.',415)
  return {filename,title:title.trim(),publisher:publisher.trim(),format}
}
export async function readUpload(req) {
  if(!String(req.headers['content-type']).startsWith('application/octet-stream'))throw invalid('Send the original file as a binary upload.',415)
  if(Number(req.headers['content-length']||0)>MAX_UPLOAD)throw invalid('Maximum file size is 8 MB.',413)
  const chunks=[];let size=0
  for await(const chunk of req){size+=chunk.length;if(size>MAX_UPLOAD)throw invalid('Maximum file size is 8 MB.',413);chunks.push(chunk)}
  if(!size)throw invalid('Choose a nonempty document.')
  return Buffer.concat(chunks)
}
export function extractSource(buffer,metadata,{signal,timeoutMs=20000}={}) {
  if(!buffer.length||buffer.length>MAX_UPLOAD)return Promise.reject(invalid('Maximum file size is 8 MB.',413))
  return new Promise((resolve,reject)=>{
    // No caller-supplied executable, options, environment secrets or file paths.
    const env=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))
    const child=spawn(process.execPath,['--max-old-space-size=192',worker,metadata.format],{stdio:['pipe','pipe','pipe'],windowsHide:true,env})
    let output='',error=null
    const stop=reason=>{error ||= invalid(reason);child.kill()}
    const abort=()=>stop('Upload cancelled. Try again when connected.')
    const timer=setTimeout(()=>stop('Document extraction took too long. Upload a shorter or simpler document.'),timeoutMs)
    signal?.addEventListener('abort',abort,{once:true})
    if(signal?.aborted)abort()
    child.stdin.on('error',()=>{})
    child.stderr.on('data',()=>{}) // PDF/parser warnings are not an API response.
    child.stdout.setEncoding('utf8')
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(Buffer.byteLength(output)>650000)stop('Extracted document is too large.')})
    child.on('error',()=>{error=invalid('The document extractor could not start.',503)})
    child.on('close',()=>{
      clearTimeout(timer);signal?.removeEventListener('abort',abort)
      if(error)return reject(error)
      // PDFJS can emit diagnostic lines before JSON. The last line is our envelope.
      let result
      try{result=JSON.parse(output.slice(output.lastIndexOf('\n')+1))}catch{return reject(invalid('The document could not be extracted. Try a shorter text-based file.'))}
      if(result.error)return reject(invalid(result.error))
      if(!Array.isArray(result.result?.pages))return reject(invalid('Document extraction failed.'))
      resolve({...metadata,...result.result,hash:createHash('sha256').update(buffer).digest('hex')})
    })
    child.stdin.end(buffer)
  })
}
