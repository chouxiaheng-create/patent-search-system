// components/flow/nodes/index.ts
export { ParseNode } from './parse-node'
export { SearchTaskNode } from './search-task-node'
export { ReportNode } from './report-node'
export { PlaceholderNode } from './placeholder-node'

import { ParseNode } from './parse-node'
import { SearchTaskNode } from './search-task-node'
import { ReportNode } from './report-node'
import { PlaceholderNode } from './placeholder-node'

export const nodeTypes = {
  parse: ParseNode,
  searchTask: SearchTaskNode,
  report: ReportNode,
  placeholder: PlaceholderNode,
}
