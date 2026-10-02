import {describe,expect,it} from 'vitest';
import {portalConfiguration,portalArticleInput,portalPublicRead,publicPortal} from './contract';
const id='11111111-1111-4111-8111-111111111111',source='22222222-2222-4222-8222-222222222222';
const config={id,agentId:source,slug:'fixture-store',brand:{name:'Fixture Store',description:'Help for customers',accent:'#123456'},revision:0,published:false};
const article={id,portalId:source,sourceId:source,sourceRevision:1,title:'Returns',body:'Reviewed return policy excerpt',locale:'en',revision:0};
describe('Reviewed shared-source help portal boundaries',()=>{
 it('allows a branded draft without changing assistant identity or publishing private documents implicitly',()=>{
  expect(portalConfiguration.safeParse(config).success).toBe(true);expect(portalArticleInput.safeParse(article).success).toBe(true);
  expect(portalConfiguration.safeParse({...config,actor_id:id}).success).toBe(false);expect(portalArticleInput.safeParse({...article,workspace_id:id}).success).toBe(false);
 });
 it.each(['../private','my-store?token=secret','UPPERCASE','my-store/other','x'.repeat(65)])('rejects unsafe public slugs',slug=>{
  expect(portalPublicRead.safeParse({slug,locale:'en'}).success).toBe(false);
 });
 it('requires exact source version and bounded literal article text',()=>{
  expect(portalArticleInput.safeParse({...article,sourceRevision:0}).success).toBe(false);expect(portalArticleInput.safeParse({...article,body:'x'.repeat(16001)}).success).toBe(false);
  expect(portalArticleInput.safeParse({...article,body:'😀'.repeat(12001)}).success).toBe(false);
 });
 it('does not expose assistant IDs, private source metadata or actor scope through the public response',()=>{
  const response={slug:config.slug,brand:config.brand,locale:'en',articles:[]};expect(publicPortal.safeParse(response).success).toBe(true);
  for(const patch of [{agentId:id},{sourceId:source},{workspace_id:id},{actor_id:id}])expect(publicPortal.safeParse({...response,...patch}).success).toBe(false);
 });
});
