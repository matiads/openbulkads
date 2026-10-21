import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = () => readFileSync(resolve('.github/workflows/release-image.yml'), 'utf8');

test('the image is published on release and on manual dispatch', () => {
  const contents = workflow();
  assert.match(contents, /^on:\n\s+release:\n\s+types: \[published\]\n\s+workflow_dispatch:/m);
  const triggers = /^on:[\s\S]*?^permissions:/m.exec(contents)?.[0] ?? '';
  assert.doesNotMatch(triggers, /^\s+(push|pull_request):/m, 'never publish from branch pushes or PRs');
});

test('the workflow has least-privilege permissions and logs in to ghcr.io with GITHUB_TOKEN', () => {
  const contents = workflow();
  assert.match(contents, /^permissions:\n\s+contents: read\n/m);
  assert.match(contents, /^\s{4}permissions:\n\s{6}contents: read\n\s{6}packages: write$/m);
  assert.match(contents, /registry: ghcr\.io/);
  assert.match(contents, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
});

test('the image is built for amd64 and arm64 with QEMU and Buildx pinned to major versions', () => {
  const contents = workflow();
  assert.match(contents, /platforms: linux\/amd64,linux\/arm64/);
  for (const action of ['actions/checkout@v4', 'docker/setup-qemu-action@v3', 'docker/setup-buildx-action@v3', 'docker/login-action@v3', 'docker/build-push-action@v6']) {
    assert.ok(contents.includes(`uses: ${action}`), `missing ${action}`);
  }
  assert.match(contents, /push: true/);
});

test('tags are the version without the leading v, major.minor, and latest only for stable releases', () => {
  const contents = workflow();
  assert.match(contents, /images: ghcr\.io\/matiads\/openbulkads/);
  assert.match(contents, /version="\$\{TAG#v\}"/);
  assert.match(contents, /type=raw,value=\$\{\{ steps\.version\.outputs\.version \}\}/);
  assert.match(contents, /type=raw,value=\$\{\{ steps\.version\.outputs\.major_minor \}\}/);
  assert.match(contents, /type=raw,value=latest,enable=\$\{\{ steps\.version\.outputs\.latest == 'true' \}\}/);
  assert.match(contents, /github\.event\.release\.prerelease/);
});

test('the image carries OCI source, description and license labels', () => {
  const contents = workflow();
  assert.match(contents, /org\.opencontainers\.image\.source=https:\/\/github\.com\/matiads\/openbulkads/);
  assert.match(contents, /org\.opencontainers\.image\.description=/);
  assert.match(contents, /org\.opencontainers\.image\.licenses=MIT/);
});

test('the CI check name required on main is untouched', () => {
  assert.match(readFileSync(resolve('.github/workflows/ci.yml'), 'utf8'), /name: Lint, types, tests and build/);
});

test('manual runs take a required tag input, check out that tag and never move latest', () => {
  const contents = workflow();
  assert.match(contents, /workflow_dispatch:\n\s+inputs:\n\s+tag:\n[\s\S]*?required: true/);
  assert.doesNotMatch(contents, /^\s+version:\n\s+description/m);
  assert.match(contents, /uses: actions\/checkout@v4\n\s+with:\n\s+ref: \$\{\{ github\.event\.release\.tag_name \|\| inputs\.tag \}\}/);
  assert.match(contents, /EVENT: \$\{\{ github\.event_name \}\}[\s\S]*\"\$EVENT\" = release/, 'latest is decided only for release events');
});

test('the tag must be an exact semver, and prereleases only publish their exact tag', () => {
  const contents = workflow();
  assert.match(contents, /\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\(-\[0-9A-Za-z\.-\]\+\)\?\$/);
  assert.doesNotMatch(contents, /\[0-9\]\*\.\[0-9\]\*\.\[0-9\]\*/, 'no loose glob match');
  assert.match(contents, /enable=\$\{\{ steps\.version\.outputs\.stable == 'true' \}\}/);
});
