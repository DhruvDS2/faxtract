# faxtract: referral intake for a diagnostic imaging clinic

Faxed radiology referrals go in. Structured, insurance-checked orders come out in the RIS, with a human in the loop exactly where the model is unsure.

- **Pipeline:** a LangGraph pipeline handles extraction, validation, X12 270/271 eligibility, prior-auth rules with RAG over payor policies, and a prior-auth packet. It pauses for a reviewer, then sends an HL7 `ORM^O01` over MLLP to a mock RIS.
- **Interface:** a React review UI shows the fax with field highlights, a live pipeline graph, evals and RIS orders. An MCP server sits over the RIS.
- **Data:** all of it is synthetic. No real patient information is used anywhere.

**Everything lives in [`referral-intake/`](referral-intake/README.md).** That README is the source of truth: demo, setup, architecture and results, each number traced to a committed artifact.

```bash
cd referral-intake && make demo
```
