// One document per process. No originals, attachments, images or converted HTML are saved.
const MAX_TEXT=90000,MAX_EXPANDED=20*1024*1024
// eslint-disable-next-line no-control-regex -- Strip/reject binary control characters in document input.
const clean=s=>s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/\r\n?/g,'\n').trim()
function sections(text) {
  text=clean(text)
  if(text.length>MAX_TEXT)throw Error('This document has more than 90,000 text characters. Upload a shorter chapter or section.')
  const pages=[]
  for(let pos=0;pos<text.length;pos+=1800)pages.push({label:'s'+(pages.length+1),text:text.slice(pos,pos+1800)})
  return pages
}
async function checkZip(buffer) {
  const {default:yauzl}=await import('yauzl')
  await new Promise((resolve,reject)=>{
    yauzl.fromBuffer(buffer,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>{
      if(error)return reject(Error('The Word file is not a readable DOCX archive.'))
      let count=0,total=0,declared=0,ended=false
      const names=new Set()
      const bad=message=>{if(!ended){ended=true;zip.close();reject(Error(message))}}
      zip.on('error',()=>bad('The Word archive is damaged or has invalid entry sizes.'))
      zip.on('entry',entry=>{
        const name=entry.fileName
        if(++count>2000||!Number.isSafeInteger(entry.uncompressedSize)||(declared+=entry.uncompressedSize)>MAX_EXPANDED)
          return bad('The expanded Word file is too large. Upload a shorter document.')
        if(names.has(name.toLowerCase())||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||/^[a-z]:/i.test(name)||
          (entry.generalPurposeBitFlag&1)||!([0,8].includes(entry.compressionMethod))||((entry.externalFileAttributes>>>16)&0xf000)===0xa000)
          return bad('The Word archive contains unsupported entries.')
        names.add(name.toLowerCase())
        zip.openReadStream(entry,(err,stream)=>{
          if(err)return bad('The Word archive could not be checked.')
          stream.on('data',chunk=>{total+=chunk.length;if(total>MAX_EXPANDED){stream.destroy();bad('The expanded Word file is too large.')}})
          stream.on('error',()=>bad('The Word archive has invalid entry sizes.'))
          stream.on('end',()=>{if(!ended)zip.readEntry()})
        })
      })
      zip.on('end',()=>{
        if(ended)return
        ended=true
        if(!names.has('word/document.xml')||!names.has('[content_types].xml'))return reject(Error('Upload a DOCX document, not another ZIP file.'))
        resolve()
      })
      zip.readEntry()
    })
  })
}
async function extract(buffer,format) {
  let pages,warnings=[]
  if(format==='pdf') {
    if(!buffer.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('This file does not contain a PDF document.')
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task=getDocument({data:new Uint8Array(buffer),disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,useWasm:false,enableXfa:false,stopAtErrors:true})
    let doc
    try {
      doc=await task.promise
      if(doc.numPages>60)throw Error('Upload at most 60 PDF pages. Choose the chapter or lesson you need.')
      pages=[];let length=0
      for(let i=1;i<=doc.numPages;i++) {
        const page=await doc.getPage(i)
        const stream=page.streamTextContent(),reader=stream.getReader()
        let pageText=''
        while(true){
          const {value,done}=await reader.read();if(done)break
          for(const item of value.items||[])if('str' in item){pageText+=item.str+(item.hasEOL?'\n':' ')}
          if(length+pageText.length>MAX_TEXT){await reader.cancel();throw Error('This PDF has more than 90,000 text characters. Upload a shorter section.')}
        }
        const text=clean(pageText);length+=text.length
        pages.push({label:'p'+i,text});page.cleanup()
      }
      if(pages.some(p=>!p.text))warnings.push('Some pages contain no extractable text. Images, charts and handwritten content are not interpreted.')
      warnings.push('PDF reading order and tables may need correction. Only selectable text is extracted; no OCR.')
    }catch(error){
      if(error.name==='PasswordException')throw Error('This PDF is password protected. Upload an unlocked copy you can use.')
      if(/Upload|90,000/.test(error.message))throw error
      throw Error('The PDF could not be read. Try exporting a text-based PDF or paste the material into a text file.')
    }finally{await task.destroy()}
  }else if(format==='docx') {
    if(!buffer.subarray(0,2).equals(Buffer.from('PK')))throw Error('This file does not contain a DOCX document.')
    await checkZip(buffer)
    const {default:mammoth}=await import('mammoth')
    const result=await mammoth.extractRawText({buffer})
    pages=sections(result.value)
    warnings.push('Word text is grouped into numbered sections, not original page numbers. Images and layout are not interpreted.')
  }else{
    let text
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer)}catch{throw Error('Save this text file as UTF-8 and upload it again.')}
    if(text.includes('\0'))throw Error('Upload a UTF-8 text file, not a binary document.')
    pages=sections(text.replace(/^\uFEFF/,''))
  }
  if(!pages.some(p=>p.text.trim()))throw Error('No readable text was found. Scanned PDFs need OCR first; upload selectable text, DOCX or a text file.')
  return {pages,warnings}
}
try {
  const chunks=[];let bytes=0
  for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>8*1024*1024)throw Error('Maximum file size is 8 MB.');chunks.push(chunk)}
  const result=await extract(Buffer.concat(chunks),process.argv[2])
  process.stdout.write(JSON.stringify({result}))
}catch(error){process.stdout.write(JSON.stringify({error:error.message?.slice(0,350)||'Document extraction failed.'}));process.exitCode=1}
