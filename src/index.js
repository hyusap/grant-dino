import "dotenv/config";

import _bolt from "@slack/bolt";
const { App } = _bolt;

import applyView from "./views/apply.js";
import { sign, verify } from "./jwt.js";

import { v4 as uuid } from "uuid";
import uploadView from "./views/upload.js";

function extractUrl(url) {
  // stolen from https://urlregex.com
  const match = url?.match(
    /(([A-Za-z]{3,9}:(?:\/\/)?)(?:[\-;:&=\+\$,\w]+@)?[A-Za-z0-9\.\-]+|(?:www\.|[\-;:&=\+\$,\w]+@)[A-Za-z0-9\.\-]+)((?:\/[\+~%\/\.\w\-_]*)?\??(?:[\-\+=&;%@\.\w_]*)#?(?:[\.\!\/\\\w]*))?/
  );

  if (!match) return null;

  return match[0];
}

const app = new App({
  token: process.env.SLACK_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  customRoutes: [
    {
      method: "GET",
      path: "/apply",
      async handler(req, res) {
        const url = new URL(req.url, "https://example.com");

        const state = await verify(url.searchParams.get("s"));

        res.setHeader("Content-Type", "text/html");
        res.end(
          `<!DOCTYPE html>
<html>
  <body>
    <form method="POST">
      <input type="file" name="venue-proof" />
      <input type="submit" />
    </form>
    <!-- <pre><code>${JSON.stringify(state)}</code></pre> -->
  </body>
</html>`
        );
      },
    },
    {
      method: "POST",
      path: "/apply",
      async handler(req, res) {
        const url = new URL(req.url, "https://example.com");

        const state = await verify(url.searchParams.get("s"));

        await app.client.views.update({
          external_id: state.external_id,
          view: uploadView({
            state: url.searchParams.get("s"),
            venueProofUploaded: true,
          }),
        });

        res.end("yay!");
      },
    },
  ],
});

app.message(async ({ message, client }) => {
  if (message.channel != process.env.GRANTS_CHANNEL) return;
  if (message.subtype) return;

  if (!message.thread_ts) {
    // Top-level message!

    const url = extractUrl(message.text);

    if (url) {
      await client.chat.postMessage({
        channel: message.channel,
        text: `<@${message.user}> over here!`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "is this a hackathon I spot? click the button to start your application!",
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  emoji: true,
                  text: ":point_right: APPLY :point_left:",
                },
                style: "primary",
                action_id: "apply",
                value: await sign({
                  original_ts: message.ts,
                  url,
                  user: message.user,
                }),
              },
            ],
          },
        ],
        thread_ts: message.ts,
      });
      await client.reactions.add({
        name: "hyper-dino-wave",
        channel: message.channel,
        timestamp: message.ts,
      });
    } else {
      await client.reactions.add({
        name: "confused-dino",
        channel: message.channel,
        timestamp: message.ts,
      });
      await client.chat.postEphemeral({
        channel: message.channel,
        user: message.user,
        text: "Hmm, I don't see a URL in that message— try posting your hackathon's website URL here!",
      });
    }
  }
});

app.action("apply", async ({ client, body, ack, action }) => {
  await ack();

  const state = await verify(action.value);

  if (body.user.id != state.user) return;

  state.ts = body.message.ts;

  await client.views.open({
    trigger_id: body.trigger_id,
    view: applyView({
      url: state.url,
      state: await sign(state),
    }),
  });
});

app.view("apply", async ({ ack, view }) => {
  const state = await verify(view.private_metadata);

  const externalId = uuid();
  state.external_id = externalId;

  await ack({
    response_action: "push",
    view: uploadView({
      state: await sign(state),
      externalId,
    }),
  });
});

app.view("apply2", async ({ ack, view, client }) => {
  const state = await verify(view.private_metadata);

  const text =
    "Your application has been submitted! We'll review it and get back to you within 24 hours.";

  await client.chat.update({
    channel: process.env.GRANTS_CHANNEL,
    ts: state.ts,
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      },
    ],
  });

  await client.reactions.add({
    name: "large_orange_circle",
    channel: process.env.GRANTS_CHANNEL,
    timestamp: state.original_ts,
  });
  await client.reactions.remove({
    name: "hyper-dino-wave",
    channel: process.env.GRANTS_CHANNEL,
    timestamp: state.original_ts,
  });

  await ack({ response_action: "clear" });
});

// idk
app.action("idk", async ({ ack }) => await ack());

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("💰 grantbot is now dealing out grants!");
})();
