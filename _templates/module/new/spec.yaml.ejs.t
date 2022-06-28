---
to: <%= h.changeCase.param(name) %>/spec.yaml
---

moduleId: <%= h.changeCase.param(name) %>

info:
  title: <%= h.changeCase.title(name) %>
  description: <%= h.changeCase.title(name) %> Builtin Module
  author: Dataland Devs <devs@dataland.io>
  sourceCodeUrl: https://github.com/dataland-io/dataland-builtin-modules/tree/main/<%= h.changeCase.param(name) %>
  readmePath: README.md
  iconPath: null

buildCommand: npm run build

workers:
  - workerId: <%= h.changeCase.param(name) %>-worker
    scriptPath: dist/<%= h.changeCase.camel(name) %>.bundle.js
