# Vendored lint plugin

`ultracite/plugin.mjs` is the unmodified anti-slop Oxlint plugin from
`ultracite@8.0.0`, `config/oxlint/anti-slop/plugin.mjs`.

The npm package omits its MIT license. `ultracite/license.md` comes from the exact
release commit, [3cbb8b6dfe855a1987875838351c6fa4e009d773](https://github.com/haydenbleasel/ultracite/tree/3cbb8b6dfe855a1987875838351c6fa4e009d773).

Only this plugin is used by the repository. Vendoring it removes the unused CLI
and its vulnerable `braces` dependency while preserving every configured lint rule.
When updating, copy the plugin and license without formatting either file.

SHA-256:

```text
812db5f9a816f9832633156e4c6acd9740bcc2fc88f4c4c8a511aa3a9f7702c6  ultracite/plugin.mjs
1489f7f3f3a315714a5499c0edd932102db31228dfc17eebf4c89a620988a813  ultracite/license.md
```
