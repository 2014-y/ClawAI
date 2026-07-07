# Waltz Flight Assistant Plugin

Book a flight end to end, in one conversation.

No more 14 tabs and a spreadsheet.

This package bundles:

- `flight_assistant` for conversational flight search, booking retrieval, Stripe card setup handoff, booking approval, and booking completion
- a bundled runtime skill that teaches OpenClaw when to call `flight_assistant`, how to handle the Stripe links returned by the backend, and how to continue the same trip after the user comes back

## Install

### Recommended installation prompt

Give this prompt to OpenClaw:

```text
can you please install the waltz flight assistant plugin and set the baseUrl to https://api.flywithwaltz.com? after installation succeeds, tell me to try: Fly me from New York to Los Angeles on July 5
```

### Manual install

Install the plugin from ClawHub:

```bash
openclaw plugins install clawhub:@waltzofwhispers/flight-assistant-plugin
```

Then update `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "waltz-flight-assistant": {
        "enabled": true,
        "config": {
          "baseUrl": "https://api.flywithwaltz.com"
        }
      }
    }
  }
}
```

Restart the gateway:

```bash
openclaw gateway restart
```

## Booking flow

1. Use `flight_assistant` for search, flight selection, and passenger details.
2. Only after the user is ready to book, let `flight_assistant` check whether a saved card exists.
3. If no saved card exists, send the Stripe-hosted setup link returned by `flight_assistant`.
4. After setup, return to `flight_assistant` and ask for explicit approval to charge the saved card.
5. If the bank requires customer authentication, send the hosted authentication link returned by `flight_assistant`.

Hard rules:

- The merchant is the AI Flight Assistant, not the airline.
- Do not ask for payment setup during browsing or comparison.
- Do not ask for a specific wallet or off-platform payment flow.

## Booking retrieval

Use the same `flight_assistant` tool for post-booking questions such as:

- `What flights do I have coming up?`
- `Show my bookings`
- `What is my booking reference for Shanghai?`

The hosted backend handles booking recall from stored bookings for the current OpenClaw user identity.

## Publish

ClawHub plugin packages use the package publish flow:

```bash
bunx clawhub package publish . \
  --family code-plugin \
  --name @waltzofwhispers/flight-assistant-plugin \
  --display-name "Waltz Flight Assistant" \
  --version 0.2.8 \
  --source-repo WaltzOfWhispers/waltz-flight-assistant-plugin \
  --source-commit "$(git rev-parse HEAD)" \
  --source-ref main \
  --source-path . \
  --changelog "Describe the release"
```

This repository is the standalone source for the Waltz Flight Assistant OpenClaw plugin. Update the GitHub owner or package metadata if you publish it from a different org or account.
