# BoxLoop — subscription & membership billing

PRD: `docs/PRD.md`. Learning project: state machines, proration, dunning, idempotent billing runs. Mock payment provider only; not deployed.

## Stack
- Clone of saas foundation **v1.2.0**, port **4800**. Template-owned paths are never edited here.
- Money: `Int` cents named `...Cents`, rates in basis points `...Bps`. No floats, no `Decimal`.
- Local Postgres only (`boxloop`, `boxloop_test`); tests never point at a remote DB.
