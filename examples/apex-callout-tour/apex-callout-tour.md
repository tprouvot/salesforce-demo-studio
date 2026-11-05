---
type: demo
title: Apex HTTP callouts, a guided tour
org: myOrg                # your sf alias; or record with: sfdemo demo apex-callout-tour.md --org <alias>
voice: en_US-amy-medium
pace: presenter
slides: slides            # 01.png ... 07.png, exported from the deck (the demo-deck skill does it)
windows:
  Admin: { path: /lightning/setup/SetupOneHome/home, label: "Admin · Setup" }
say:
  x-api-key: x A P I key
  postman-echo.com: postman echo dot com
---

<!--
The guided tour of https://github.com/tprouvot/apex-http-callout, as a narrated demo. The org needs the repo
deployed and its demo set up (the README's "Guided tour": Demo ERP Credential, Demo ERP API, two Callout Settings).
Paragraphs are spoken; list items are what happens on screen.
-->

# Opening

- slide: 1

Hello, and welcome. In the next few minutes, I'll walk you through a small Apex framework for outbound HTTP
callouts, live in a Salesforce org.

It answers a simple question: how do you call an external API from Apex, without hard-coding its address, its
timeout, or its secret?

- slide: 2

Each callout is one record of a custom setting: where to call, through which Named Credential, how long to wait, and
which headers to send. Apex then makes the call in one line, by the name of that record.

The secret itself lives in an External Credential. It never shows in Setup, in Apex, or in the custom setting. Let's
look at each piece.

# The External Credential holds the secret

- slide: 3

First, the secret. An External Credential stores the API key, encrypted, in what Salesforce calls a principal.

- window: Admin
- setup: Named Credentials

Here is Setup, on the Named Credentials page. The External Credentials have their own tab.

- ai: open the External Credential named Demo ERP Credential

The Demo ERP Credential uses the Custom authentication protocol.

- point: DemoPrincipal

Its principal holds one parameter, the API key, stored encrypted.

- scroll: x-api-key
- point: x-api-key

And a custom header, x-api-key, reads that key with a formula. The key itself is never visible.

# The Named Credential points to the API

- slide: 4

Next, the Named Credential. It holds the base URL of the API, and takes its key from the External Credential.

- window: Admin
- setup: Named Credentials
- click: Demo ERP API

Here it is. The URL is postman-echo.com, a public service that sends back what it receives, so we can see exactly
which headers reach the API.

- point: Allow Formulas in HTTP Header

Allow Formulas in HTTP Header is checked. That is what puts the real key in the header, when the callout leaves
Salesforce.

# One setting per callout

- slide: 5

Then, one Callout Settings record per callout.

- window: Admin
- setup: Custom Settings
- click: Callout Settings
- click: Manage

Two callouts use the same Named Credential: OrderStatus, and PriceSimulation.

- click: OrderStatus

OrderStatus adds a path, with a placeholder for the order number, a ten-second timeout, and two headers that are not
secret. The API key is not here: it comes from the External Credential.

# Call it from Apex

- slide: 6

Now, the call itself: one line of Apex, by the name of the setting.

- window: Admin

```apex
HttpResponse res = HttpRequestUtils.getHttpResponse('OrderStatus', new List<String>{ '00012345' }, 'GET', '', 'order: 00012345');
System.debug(res.getStatusCode() + ' ' + res.getBody());
```

The echo service sends back what it received. The order number filled the placeholder in the URL. Accept and the
correlation ID came from the OrderStatus record. And x-api-key came from the External Credential, with the stored key.

# Close

- slide: 7

That's the whole framework: one record per callout, the secret in an External Credential, and one line of Apex.
Thank you for watching.
