---
to: <%= h.changeCase.param(name) %>/spec.yaml
---

moduleId: <%= h.changeCase.param(name) %>

buildCommand: npm run build

workers:
  - workerId: <%= h.changeCase.param(name) %>-worker
    scriptPath: dist/<%= h.changeCase.camel(name) %>.bundle.js
