import { describe,expect,it } from 'vitest'
import { gapKnowledgeInput,prepareGapFaq } from './gap-knowledge'
const product='66666666-6666-4666-8666-666666666666'
describe('bounded human knowledge preparation',() => {
 it('retains the default product destination, never silently truncates or accepts arbitrary targets',() => {
  const input={ action:'preview',key:'delivery',question:'Delivery?',answer:'Only confirmed dates',product_id:product }
  expect(gapKnowledgeInput(input)).toMatchObject({ destino:'producto' })
  for (const bad of [{ ...input,answer:'a'.repeat(2001) },{ ...input,destino:'unknown' },{ ...input,product_id:'not-an-id' },{ ...input,workspace_id:product },{ ...input,question:'' }]) expect(gapKnowledgeInput(bad)).toBeNull()
 })
 it('accepts only an exact review receipt for confirmation',() => {
  expect(gapKnowledgeInput({ action:'confirm',review_id:product })).toEqual({ action:'confirm',review_id:product })
  expect(gapKnowledgeInput({ action:'confirm',review_id:product,answer:'Modified after review' })).toBeNull()
  expect(gapKnowledgeInput({ key:'delivery',answer:'Unreviewed' })).toBeNull()
 })
 it('shows every equivalent FAQ that will be replaced, preserves other knowledge and recompiles with the existing compiler',() => {
  const row={ id:product,title:'Catalogue item',description:'Existing description',custom_faqs:[{ q:'Delivery?',a:'Old date' },{ q:'DELIVERY!!',a:'Different old date' },{ q:'Returns?',a:'Returns policy' }] }
  const result=prepareGapFaq(row,'delivery','Verified date','en')
  expect(result.previous).toHaveLength(2);expect(result.custom_faqs).toEqual([{ q:'Returns?',a:'Returns policy' },{ q:'delivery',a:'Verified date' }]);expect(result.training_material).toContain('Existing description');expect(result.training_material).toContain('Verified date');expect(result.training_material).toContain('Returns policy');expect(result.training_material).not.toContain('Old date');expect(row.custom_faqs).toHaveLength(3)
 })
})
