import { describe,expect,it } from 'vitest'
import { audioParts } from './audio-parts'
describe('audio source selection',() => {
  it('preserves exact attachment index and each stored transcript',() => {
    expect(audioParts({ media_url:'/primary',media_type:'voice',media_transcription:'Primary',attachments:[{ url:'/image',mime_type:'image/png' },{ url:'/primary',mime_type:'audio/ogg' },{ url:'/second.mp3',evidence:{ version:1,kind:'audio',text:'Second' } }] })).toEqual([{ index:1,url:'/primary',name:undefined,text:'Primary' },{ index:2,url:'/second.mp3',name:undefined,text:'Second' }])
  })
  it('supports legacy primary audio without duplicating it or interpreting images as audio',() => {
    expect(audioParts({ media_url:'/api/media/ws/conv/file',media_mime:'audio/mpeg',attachments:[{ url:'/api/media/ws/conv/file' }] })[0].index).toBe(0)
    expect(audioParts({ media_url:'/voice',content_type:'audio' })).toEqual([{ index:-1,url:'/voice',text:null }])
    expect(audioParts({ attachments:[{ url:'/image.jpg',mime_type:'image/jpeg',evidence:{ version:1,kind:'image',text:'Image' } }] })).toEqual([])
  })
})
