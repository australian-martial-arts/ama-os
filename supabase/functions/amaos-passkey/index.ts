// amaos-passkey: register and use passkeys (Face ID / fingerprint / device PIN) as the second step.
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@10.0.1";
import { isoBase64URL } from "npm:@simplewebauthn/server@10.0.1/helpers";
import { claims, cors, getUser, hasStepUp, sha256, sql } from "../_shared/amaos.ts";

// Passkeys made on ama-os.train-ama.com belong to train-ama.com, so they also work across AMA's
// other train-ama.com apps later. Preview addresses get their own.
function rpFor(origin: string) { const h = new URL(origin).hostname; return h.endsWith("train-ama.com") ? "train-ama.com" : h; }

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const c = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: c.headers });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...c.headers, "content-type": "application/json" } });
  if (!c.ok || !origin) return json({ ok: false, error: "Not allowed from this address." }, 403);
  try {
    const auth = req.headers.get("authorization") ?? "";
    const u = await getUser(auth); if (!u) return json({ ok: false, error: "Please sign in again." }, 401);
    const staff = await sql`select name, role from ama_os.staff where active and preview and
      ((${u.digits} <> '' and regexp_replace(coalesce(phone,''),'\\D','','g') = ${u.digits}) or (${u.email} <> '' and email = ${u.email})) limit 1`;
    if (!staff.length) return json({ ok: false, error: "This login isn't set up for AMA OS yet." }, 403);
    const s = staff[0], rpID = rpFor(origin), body = await req.json().catch(() => ({}));
    const act = String(body.act || "");
    const mine = await sql`select id, transports from ama_os.passkeys where user_id = ${u.id} and rp_id = ${rpID}`;

    if (act === "status") return json({ ok: true, count: mine.length });

    if (act === "reg-options") {
      // A first passkey can be added straight after the SMS code; any extra passkey needs the second step first.
      const stepped = claims(auth).aal === "aal2" || await hasStepUp(req, u.id);
      if (mine.length && !stepped) return json({ ok: false, error: "Confirm with an existing passkey or your authenticator app first." }, 403);
      const opts = await generateRegistrationOptions({
        rpName: "AMA OS", rpID, userName: s.name, userID: new TextEncoder().encode(u.id),
        attestationType: "none", authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        excludeCredentials: mine.map((m) => ({ id: m.id, transports: m.transports })),
      });
      await sql`insert into ama_os.webauthn_challenges (user_id, challenge, kind, expires_at) values (${u.id}, ${opts.challenge}, 'register', now() + interval '5 minutes')
        on conflict (user_id) do update set challenge = excluded.challenge, kind = excluded.kind, expires_at = excluded.expires_at`;
      return json({ ok: true, options: opts });
    }

    if (act === "reg-verify") {
      const ch = await sql`delete from ama_os.webauthn_challenges where user_id = ${u.id} and kind = 'register' and expires_at > now() returning challenge`;
      if (!ch.length) return json({ ok: false, error: "That took too long. Please try again." }, 400);
      const v = await verifyRegistrationResponse({ response: body.response, expectedChallenge: ch[0].challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
      if (!v.verified || !v.registrationInfo) return json({ ok: false, error: "The passkey couldn't be checked." }, 400);
      const ri = v.registrationInfo;
      await sql`insert into ama_os.passkeys (id, user_id, public_key, counter, transports, rp_id, label)
        values (${ri.credentialID}, ${u.id}, ${isoBase64URL.fromBuffer(ri.credentialPublicKey)}, ${ri.counter}, ${body.response?.response?.transports ?? []}, ${rpID}, ${String(body.label || "").slice(0, 60)})`;
      await sql`insert into ama_os.audit (actor, actor_login, role, action, detail) values (${s.name}, ${u.digits || u.email}, ${s.role}, 'passkey.add', ${sql.json({ rpID })})`;
      return json({ ok: true });
    }

    if (act === "login-options") {
      if (!mine.length) return json({ ok: false, error: "No passkey on this account yet." }, 400);
      const opts = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: mine.map((m) => ({ id: m.id, transports: m.transports })) });
      await sql`insert into ama_os.webauthn_challenges (user_id, challenge, kind, expires_at) values (${u.id}, ${opts.challenge}, 'login', now() + interval '5 minutes')
        on conflict (user_id) do update set challenge = excluded.challenge, kind = excluded.kind, expires_at = excluded.expires_at`;
      return json({ ok: true, options: opts });
    }

    if (act === "login-verify") {
      const ch = await sql`delete from ama_os.webauthn_challenges where user_id = ${u.id} and kind = 'login' and expires_at > now() returning challenge`;
      if (!ch.length) return json({ ok: false, error: "That took too long. Please try again." }, 400);
      const pk = (await sql`select * from ama_os.passkeys where id = ${String(body.response?.id || "")} and user_id = ${u.id} and rp_id = ${rpID}`)[0];
      if (!pk) return json({ ok: false, error: "That passkey isn't linked to this account." }, 400);
      const v = await verifyAuthenticationResponse({
        response: body.response, expectedChallenge: ch[0].challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        authenticator: { credentialID: pk.id, credentialPublicKey: isoBase64URL.toBuffer(pk.public_key), counter: Number(pk.counter), transports: pk.transports },
      });
      if (!v.verified) return json({ ok: false, error: "The passkey couldn't be checked." }, 400);
      await sql`update ama_os.passkeys set counter = ${v.authenticationInfo.newCounter}, last_used_at = now() where id = ${pk.id}`;
      const token = crypto.randomUUID() + crypto.randomUUID();
      await sql`delete from ama_os.stepup where user_id = ${u.id} and expires_at < now()`;
      await sql`insert into ama_os.stepup (token_hash, user_id, method, expires_at) values (${await sha256(token)}, ${u.id}, 'passkey', now() + interval '12 hours')`;
      return json({ ok: true, stepup: token });
    }
    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (_e) {
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
});
