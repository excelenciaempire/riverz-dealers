import { afterEach,describe,expect,it,vi } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
afterEach(() => { vi.unstubAllEnvs();vi.resetModules() })
describe('owner-controlled presentation of the Riverz improvements',() => {
 it.each([undefined,'','true','production'])('hides additions unless an isolated comparison build is explicitly requested (%s)',async(value) => {
  vi.stubEnv('NEXT_PUBLIC_RIVERZ_UI_STAGE',value);vi.resetModules()
  expect((await import('./improvements-preview')).SHOW_RIVERZ_IMPROVEMENTS).toBe(false)
 })
 it('keeps the additions available for a deliberate comparison build',async() => {
  vi.stubEnv('NEXT_PUBLIC_RIVERZ_UI_STAGE','comparison');vi.resetModules()
  expect((await import('./improvements-preview')).SHOW_RIVERZ_IMPROVEMENTS).toBe(true)
 })
 it('never mounts new controls in normal UI parents, including nested message controls',() => {
  const surfaces:Record<string,string[]>={
   'src/app/(dashboard)/bandeja/page.tsx':['TeamNotifications','SavedViews','TeamCapacity'],
   'src/components/inbox/message-thread.tsx':['ConversationCollaboration','ConversationUnderstanding'],
   'src/components/inbox/conversation-collaboration.tsx':['CaseGapAnswers'],
   'src/components/inbox/message-bubble.tsx':['MessageUnderstanding'],
   'src/components/inbox/message-composer.tsx':['OutgoingTranslation'],
   'src/components/inbox/message-actions.tsx':['MessageEvidence'],
   'src/components/inbox/contact-sidebar.tsx':['OperationLinks'],
   'src/components/inbox/shopify-contact-panel.tsx':['CaseOrderActions'],
   'src/components/inbox/conversation-list.tsx':['BulkCaseActions'],
   'src/components/ai/reglas-panel.tsx':['RuleVersions'],
   'src/components/ai/answer-gaps-panel.tsx':['GapKnowledgeHistory'],
   'src/components/templates/template-builder.tsx':['TemplateAiDraft'],
  }
  for (const [path,names] of Object.entries(surfaces)) {
   const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),found=new Set<string>()
   function walk(node:ts.Node) {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
     const name=node.tagName.getText(source)
     if (names.includes(name)) {
      found.add(name);let parent:ts.Node|undefined=node.parent,guarded=false
      while (parent) {
       if (ts.isBinaryExpression(parent) && parent.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken && parent.left.getText(source).includes('SHOW_RIVERZ_IMPROVEMENTS')) guarded=true
       if (ts.isConditionalExpression(parent) && parent.condition.getText(source)==='SHOW_RIVERZ_IMPROVEMENTS' && parent.whenTrue.pos<=node.pos && parent.whenTrue.end>=node.end) guarded=true
       parent=parent.parent
      }
      expect(guarded,`${path}: ${name} mounts without the comparison gate`).toBe(true)
     }
    }
    ts.forEachChild(node,walk)
   }
   walk(source);expect([...found].sort(),path).toEqual([...names].sort())
  }
 })
})
