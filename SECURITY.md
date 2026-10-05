# Security

Do not open a public issue for a suspected vulnerability. Report it privately
through GitHub's security-advisory interface for this repository.

The SDK treats node responses, relay responses, DHT providers, and Volume bytes
as untrusted input. Security fixes should include a regression test at the
boundary where the invalid input was accepted.
