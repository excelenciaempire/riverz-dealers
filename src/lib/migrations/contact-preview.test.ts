import {describe,it,expect} from 'vitest';
import {readMigrationCsv,previewContactMigration,MIGRATION_MAX_BYTES,MIGRATION_PROVIDERS,MigrationPreviewError,type MigrationMapping} from './contact-preview';
const mapping:MigrationMapping={sourceId:0,phone:1,name:2,email:3,company:4};
const headers=['id','phone','name','email','company'];
const contact=['source-1','+12025550101','Synthetic Person','synthetic@example.test','Synthetic Store'];
const run=(rows:string[][],custom:MigrationMapping=mapping)=>previewContactMigration({provider:'chatwoot',account:' Synthetic account ',headers,rows,mapping:custom});
function code(fn:()=>unknown,expected:MigrationPreviewError['code']){try{fn();throw Error('Unexpected success');}catch(error){expect(error).toBeInstanceOf(MigrationPreviewError);expect((error as MigrationPreviewError).code).toBe(expected);}}
describe('Local contact migration review',()=>{
  it.each([',',';','\t'])('reads %s with quoted delimiter, double quotes and multiline fields',delimiter=>{
    const result=readMigrationCsv(`\uFEFFid${delimiter}name\r\na${delimiter}"Synthetic${delimiter} \"\"Person\"\"\nSecond line"\r\n`);
    expect(result).toEqual({headers:['id','name'],rows:[['a',`Synthetic${delimiter} "Person"\nSecond line`]]});
  });
  it('does not choose a separator embedded in a quoted header',()=>{expect(readMigrationCsv('"Id, original";phone\na;+12025550101').headers).toEqual(['Id, original','phone']);});
  it('retains an explicit trailing empty cell and ignores fully blank lines',()=>{expect(readMigrationCsv('id,name,phone\na,Synthetic,\n\n').rows).toEqual([['a','Synthetic','']]);});
  it.each(['id,name\na,"unfinished','id,name\na,"quoted"junk','id,name\na,b"c','id,name\na','id,name\na,b,c','id,name'])('rejects damaged/incomplete CSV %s',csv=>code(()=>readMigrationCsv(csv),'csv'));
  it('enforces bytes, cell length and columns before accepting a file',()=>{
    code(()=>readMigrationCsv('á'.repeat(MIGRATION_MAX_BYTES/2+1)),'size');
    code(()=>readMigrationCsv(`id,name\na,${'x'.repeat(4097)}`),'limits');
    code(()=>readMigrationCsv(`${Array(65).fill('head').join(',')}\n${Array(65).fill('v').join(',')}`),'limits');
  });
  it('accepts all 5000 rows, refuses row 5001 instead of silently truncating',()=>{
    expect(readMigrationCsv(`id,name\n${Array(5000).fill('a,Synthetic').join('\n')}`).rows).toHaveLength(5000);
    code(()=>readMigrationCsv(`id,name\n${Array(5001).fill('a,Synthetic').join('\n')}`),'limits');
  });
  it.each(MIGRATION_PROVIDERS)('retains %s provenance without converting a source ID into a channel ID',provider=>{
    const result=previewContactMigration({provider,account:'Synthetic source',headers,rows:[contact],mapping});
    expect(result.provider).toBe(provider);expect(result.rows[0].sourceId).toBe('source-1');expect(result.reviewable).toBe(1);
    expect(result.rows[0]).not.toHaveProperty('external_id');expect(result.rows[0]).not.toHaveProperty('opt_in');expect(result.rows[0]).not.toHaveProperty('workspace_id');
  });
  it('normalizes international formatting without guessing a country',()=>{
    expect(run([[...contact.slice(0,1),'+1 (202) 555-0101',...contact.slice(2)]]).rows[0].phone).toBe('+12025550101');
    expect(run([[contact[0],'2025550101',...contact.slice(2)]]).rows[0].issues).toContain('phone_invalid');
  });
  it.each(['+1 202 555 0101 ext 2','+12025550101 text','+12025550101x2','+123','+'])('refuses ambiguous or invalid phone %s',phone=>expect(run([[contact[0],phone,...contact.slice(2)]]).rows[0].issues).toContain('phone_invalid'));
  it('does not merge different source IDs that share a telephone',()=>{const result=run([contact,['source-2',...contact.slice(1)]]);expect(result.reviewable).toBe(0);expect(result.excluded).toBe(2);expect(result.rows.every(row=>row.issues.includes('phone_conflict'))).toBe(true);});
  it('does not let a later conflicting source row overwrite the first',()=>{const result=run([contact,[contact[0],'+12025550102',...contact.slice(2)]]);expect(result.reviewable).toBe(0);expect(result.rows.every(row=>row.issues.includes('source_conflict'))).toBe(true);});
  it('excludes exact repeated rows while preserving the original row and count',()=>{const result=run([contact,[...contact]]);expect(result.reviewable).toBe(1);expect(result.excluded).toBe(1);expect(result.rows[1]).toMatchObject({row:3,issues:['duplicate']});});
  it('equal emails do not link different phones or identities',()=>{const result=run([contact,['source-2','+12025550102',...contact.slice(2)]]);expect(result.reviewable).toBe(2);});
  it('returns missing ID and invalid email as errors without dropping the original row',()=>{const result=run([['',contact[1],contact[2],'not-an-email',contact[4]]]);expect(result.rows).toHaveLength(1);expect(result.rows[0].issues).toEqual(['source_id_missing','email_invalid']);expect(result.reviewable).toBe(0);});
  it('requires a named source and explicit independent ID/phone columns',()=>{
    code(()=>previewContactMigration({provider:'chatwoot',account:' ',headers,rows:[contact],mapping}),'source');
    code(()=>run([contact],{...mapping,sourceId:-1}),'mapping');code(()=>run([contact],{...mapping,phone:0}),'mapping');
    code(()=>run([contact],{...mapping,email:99}),'mapping');
  });
  it('keeps spreadsheet formulas and markup as inert text and never adds executable metadata',()=>{const result=run([[contact[0],contact[1],'=HYPERLINK("https://example.test")','', '<script>synthetic</script>']]);expect(result.rows[0].name).toMatch(/^=HYPERLINK/);expect(result.rows[0].company).toBe('<script>synthetic</script>');expect(result.reviewable).toBe(1);});
});
