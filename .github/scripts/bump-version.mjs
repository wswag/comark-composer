import { execFileSync } from 'node:child_process'
import { appendFile, readFile, writeFile } from 'node:fs/promises'

const title = process.env.PR_TITLE ?? ''
const pullRequestNumber = process.env.PR_NUMBER
const conventionalCommitTitle = title.match(/^([a-z][a-z0-9-]*)(?:\([^)]+\))?(!)?: .+$/)

if (!conventionalCommitTitle || !pullRequestNumber) {
  throw new Error('Ein Conventional-Commit-PR-Titel und eine PR-Nummer sind erforderlich.')
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
