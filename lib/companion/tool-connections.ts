import {z} from 'zod';

// Endpoint and tool scope are application-owned, never supplied by an agent or a saved URL.
export const connectionCatalog = {
  github: {
    name: 'GitHub', endpoint: 'https://api.githubcopilot.com/mcp/readonly', token: true,
    description: 'Read GitHub repository source, commits and code search in repositories accessible to your selected token.',
    tools: ['get_file_contents', 'get_commit', 'list_commits', 'search_code', 'search_repositories'],
    disclosure: 'Repository names, paths and search queries are sent to GitHub. Use a fine-grained token limited to selected repositories with read-only Contents permission. No push, issue creation or pull-request mutation is exposed.',
    docs: 'https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md',
  },
  deepwiki: {
    name: 'DeepWiki', endpoint: 'https://mcp.deepwiki.com/mcp', token: false,
    description: 'Find documentation and explanations of public GitHub repositories through DeepWiki.',
    tools: ['read_wiki_structure', 'read_wiki_contents', 'ask_wiki_question'],
    disclosure: 'Repository names and questions are sent to DeepWiki. Use public repository information only; do not send private source, credentials or personal records. Generated explanations need verification against source.',
    docs: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
  },
} as const;
export type ConnectionProvider = keyof typeof connectionCatalog;
export type ToolConnection = {id:string;provider:ConnectionProvider;revision:number;status:'active'|'disconnected';background_access?:boolean;voice_access?:boolean;expires_at:string;created_at:string;updated_at:string};
export const toolConnectionMutation = z.object({
  action:z.enum(['connect','disconnect','permissions']), requestKey:z.uuid(), provider:z.enum(['github','deepwiki']),
  backgroundAccess:z.boolean().optional(),
  voiceAccess:z.boolean().optional(),
  revision:z.number().int().nonnegative(), expiresAt:z.iso.datetime().optional(),
  token:z.string().trim().min(20).max(500).regex(/^[A-Za-z0-9_]+$/).optional(),
}).strict().superRefine((v,c)=>{
  if(v.action==='connect'&&!v.expiresAt)c.addIssue({code:'custom',message:'Choose an expiry'});
  if((v.action==='connect'&&connectionCatalog[v.provider].token)!==!!v.token)c.addIssue({code:'custom',message:'Provide a token only when connecting GitHub'});
  if(v.action==='disconnect'&&v.expiresAt)c.addIssue({code:'custom',message:'Disconnect does not accept an expiry'});
  if(v.action==='permissions'&&((v.backgroundAccess===undefined)===(v.voiceAccess===undefined)||v.expiresAt))c.addIssue({code:'custom',message:'Choose one access setting without changing expiry'});
  if(v.action!=='permissions'&&(v.backgroundAccess!==undefined||v.voiceAccess!==undefined))c.addIssue({code:'custom',message:'Set access separately after connecting'});
});
export class ToolConnectionError extends Error {status:number;constructor(message:string,status=409){super(message);this.status=status;}}
