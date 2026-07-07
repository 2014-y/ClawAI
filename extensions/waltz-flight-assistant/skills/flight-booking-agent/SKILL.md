---
name: flight_booking_agent
description: Use the Waltz Flight Assistant plugin tool to search real flights, retrieve existing bookings, carry context_id across turns, guide users through Stripe card setup only when they intend to book, and finish bookings after explicit approval.
metadata: {"openclaw":{"requires":{"config":["plugins.entries.waltz-flight-assistant.config.baseUrl"]}}}
---

# Flight Booking Agent

Use this skill when the user wants to search, compare, book, or retrieve real flights and existing bookings.

## Tool flow

1. Use `flight_assistant` for all search, quote, passenger-detail, booking-preparation, and booking-retrieval steps.
2. Reuse the latest `context_id` from the prior `flight_assistant` result when continuing the same trip.
3. Once a `context_id` exists for a trip, keep sending that exact `context_id` on every later `flight_assistant` call until one of these happens:
   - the booking is confirmed
   - the user explicitly cancels the trip
   - the user clearly starts a different trip
4. Only set `new_conversation: true` when the user is clearly starting a different trip or asks to reset.
5. Do not bring up payment setup during browsing. Only once the user clearly intends to book should you move into payment collection.
6. If `flight_assistant` returns `PAYMENT SETUP REQUIRED`, send the user to the Stripe-hosted setup link, then continue the same conversation after they return.
7. If `flight_assistant` returns `APPROVAL REQUIRED`, ask the user for explicit approval to charge the saved card for the exact total shown.
8. If `flight_assistant` returns `PAYMENT AUTHENTICATION REQUIRED`, send the user to the hosted authentication link, then continue the same conversation.

## Retrieval examples

Route these through `flight_assistant`:

- `What flights do I have coming up?`
- `Show my bookings`
- `What is my booking reference for Shanghai?`
- `Which flight did I book for May 8?`

## Continuation rules

- If a trip is in progress, every follow-up about that trip must go back through `flight_assistant` with the same `context_id`.
- Do not drop or replace the active `context_id` mid-booking.
- The plugin keeps hidden per-session state for active trips. Treat short follow-ups as part of the same trip unless the user explicitly cancels or starts a different one.
- Treat short replies such as `1`, `2`, `option 1`, `the cheaper one`, `Iberia`, `yes`, `no`, `go ahead`, `book it`, `continue`, and `same one` as continuation turns for the active flight conversation.
- Never answer flight follow-ups from memory when a trip is already active. Call `flight_assistant` again instead.
- Never switch to unrelated tools or skills while a flight search or booking is in progress.
- Never ask the user to restate origin, destination, or date if the current trip context already has them.

## Hard rules

- Do not ask for a specific wallet or provider unless the user explicitly wants one.
- The merchant is the AI Flight Assistant, not the airline.
- The actual payment processor is Stripe; use the card-setup or authentication links exactly as returned.
- If the user changes dates, route, cabin, or passenger details materially, go back through `flight_assistant` instead of confirming an old pending booking.
- If booking fails because the fare expired or inventory changed, explain that clearly and rerun `flight_assistant` to get a fresh option.

## Response style

- Keep the user-facing summary short for status updates, approvals, and booking confirmations.
- When `flight_assistant` returns flight search results, preserve the full option details instead of compressing them to airline + price only.
- For each presented option, keep the departure date, origin and destination airports, departure and arrival times, stops, duration, and price.
- If the tool already returned a well-formatted options block, reuse that structure with only light cleanup.
- When showing flight options, use short numbered options or short flat bullets, but do not omit the itinerary details.
- Never use markdown tables.
- Never wrap flight options in code blocks or fenced code.
- Do not restyle the tool output into a spreadsheet-like format.
- Surface the exact amount, merchant, and saved-card context when approval is required.
- When continuing a trip, preserve the existing context instead of restarting from scratch.
