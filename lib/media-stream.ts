type ExactLengthTransform = {
 readable: ReadableStream<Uint8Array>;
 writable: WritableStream<Uint8Array>;
};

// Enforces an exact declared byte count on an outbound stream. When the runtime
// does not expose a global FixedLengthStream, this fallback preserves streaming
// while guaranteeing the Content-Length sent to Meta matches the body.
function exactLengthTransform(size:number):ExactLengthTransform{
 if(!Number.isSafeInteger(size)||size<0)throw new Error('Invalid stream length');
 const NativeFixedLengthStream=(globalThis as typeof globalThis&{FixedLengthStream?:new(size:number)=>ExactLengthTransform}).FixedLengthStream;
 if(NativeFixedLengthStream)return new NativeFixedLengthStream(size);
 let seen=0;
 return new TransformStream<Uint8Array,Uint8Array>({
  transform(chunk,controller){seen+=chunk.byteLength;if(seen>size)throw new Error('Stream delivered more bytes than declared.');controller.enqueue(chunk);},
  flush(){if(seen!==size)throw new Error('Stream delivered fewer bytes than declared.');},
 });
}

// Wraps a stored media stream in a single multipart/form-data part with an exact
// Content-Length, so an image or video upload to Meta streams without buffering
// the whole body in memory.
export function multipartStream(body:ReadableStream<Uint8Array>,size:number,mediaType:string,contentType:string,boundary:string){
 const encoder=new TextEncoder(),prefix=encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${mediaType==='image'?'filename':'source'}"; filename="creative.${mediaType==='image'?'jpg':'mp4'}"\r\nContent-Type: ${contentType}\r\n\r\n`),suffix=encoder.encode(`\r\n--${boundary}--\r\n`);
 const length=prefix.byteLength+size+suffix.byteLength;
 const fixed=exactLengthTransform(length);
 const writer=fixed.writable.getWriter();
 const completion=(async()=>{const reader=body.getReader();try{await writer.write(prefix);while(true){const {done,value}=await reader.read();if(done)break;await writer.write(value);}await writer.write(suffix);await writer.close();}catch(e){await reader.cancel(e).catch(()=>{});await writer.abort(e).catch(()=>{});throw e;}finally{reader.releaseLock();writer.releaseLock();}})();
 // Keep the pump rejection observed even when fetch terminates before consuming it.
 void completion.catch(()=>{});
 return {body:fixed.readable,completion,length};
}
