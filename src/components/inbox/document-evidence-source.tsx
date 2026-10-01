'use client'
import type {SourceObservation} from '@/lib/ai/turn-evidence-contract'
import {useT} from '@/hooks/use-locale'
import {useFormat} from '@/hooks/use-format'
export function DocumentEvidenceSource({source}:{source:Extract<SourceObservation,{kind:'document'}>}) {
 const t=useT(),fmt=useFormat()
 return <span>{source.title || t('inbox.evidenceDocument')} · {t('inbox.evidenceDocumentRevision',{n:fmt.number(source.revision)})}</span>
}
