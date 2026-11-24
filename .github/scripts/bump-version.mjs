import { execFileSync } from 'node:child_process'
import { appendFile, readFile, writeFile } from 'node:fs/promises'

let event = {}
if (process.env.GITHUB_EVENT_PATH) {
  event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
}

const title = process.env.PR_TITLE ?? event.pull_request?.title ?? ''
const pullRequestNumber = process.env.PR_NUMBER ?? event.pull_request?.number?.toString()
const conventionalCommitTitle = title.match(/^([a-z][a-z0-9-]*)(?:\([^)]+\))?(!)?: .+$/)

if (!pullRequestNumber) throw new Error('Die PR-Nummer fehlt (PR_NUMBER und GitHub-Event-Payload sind leer).')
if (!conventionalCommitTitle) {
  throw new Error(`Der PR-Titel ist kein gültiger Conventional Commit: ${JSON.stringify(title)}`)
}

const marker = `Release-PR: #${pullRequestNumber}`
const history = execFileSync('git', ['log', 'origin/main', '--format=%H%x1f%s%x1f%b%x00'], {
  encoding: 'utf8',
})
const priorRelease = history.split('\x00').map(entry => entry.trim()).find(entry => entry.includes(marker))
const outputPath = process.env.GITHUB_OUTPUT

if (priorRelease) {
  const [commitSha, subject] = priorRelease.split('\x1f')
  const priorTag = subject?.match(/\bv(\d+\.\d+\.\d+)\b/)?.[0]
  if (!priorTag || !commitSha) throw new Error(`Vorheriger Release-Marker ist ungültig: ${marker}`)

  await appendFile(outputPath, `tag=${priorTag}\ncommit_sha=${commitSha}\nskip_commit=true\n`)
  console.log(`PR #${pullRequestNumber} wurde bereits als ${priorTag} veröffentlicht.`)
} else {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  const currentVersion = packageJson.version?.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!currentVersion) throw new Error(`Ungültige Paketversion: ${packageJson.version}`)

  const existingVersionTags = execFileSync('git', ['tag', '--list', 'v[0-9]*.[0-9]*.[0-9]*'], {
    encoding: 'utf8',
  }).trim()

  if (!existingVersionTags) {
    const tag = `v${packageJson.version}`
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    await appendFile(outputPath, `tag=${tag}\ncommit_sha=${commitSha}\nskip_commit=true\n`)
    console.log(`${packageJson.version} wird als erste Version ${tag} veröffentlicht.`)
    process.exit(0)
  }

  let [, majorText, minorText, patchText] = currentVersion
  let major = Number(majorText)
  let minor = Number(minorText)
  let patch = Number(patchText)

  if (conventionalCommitTitle[2]) {
    major += 1
    minor = 0
    patch = 0
  } else if (conventionalCommitTitle[1] === 'feat') {
    minor += 1
    patch = 0
  } else {
    // Every other Conventional Commit type produces a patch release.
    patch += 1
  }

  const version = `${major}.${minor}.${patch}`
  const tag = `v${version}`
  packageJson.version = version
  await writeFile('package.json', `${JSON.stringify(packageJson, null, 2)}\n`)

  // Keep npm lock metadata aligned with the release and the local example dependency.
  for (const lockfilePath of ['package-lock.json', 'examples/go-vite/package-lock.json']) {
    const lockfile = JSON.parse(await readFile(lockfilePath, 'utf8'))
    let changed = false

    if (lockfile.name === packageJson.name && lockfile.version !== version) {
      lockfile.version = version
      changed = true
    }

    for (const packageMetadata of Object.values(lockfile.packages ?? {})) {
      if (packageMetadata.name !== packageJson.name || packageMetadata.version === version) continue
      packageMetadata.version = version
      changed = true
    }

    if (changed) await writeFile(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`)
  }

  await appendFile(outputPath, `tag=${tag}\nskip_commit=false\n`)
  console.log(`${packageJson.version} wird als ${tag} veröffentlicht.`)
}
