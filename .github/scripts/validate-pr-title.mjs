const title = process.env.PR_TITLE ?? ''
const conventionalCommitTitle = /^[a-z][a-z0-9-]*(?:\([^)]+\))?!?: .+$/

if (!conventionalCommitTitle.test(title)) {
  console.error(`PR-Titel muss Conventional-Commit-Format haben: ${title}`)
  console.error('Beispiele: feat: add resolver option, fix(http): handle 404, feat!: change public API')
  process.exitCode = 1
}
