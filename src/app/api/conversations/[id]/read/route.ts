import { changeDisposition } from '@/lib/inbox/disposition-handler'
/** Only reading is exempt from the billing edit gate. Never accept other actions here. */
export async function POST(request:Request,route:{ params:Promise<{ id:string }> }) {
  return changeDisposition(request,(await route.params).id,true)
}
