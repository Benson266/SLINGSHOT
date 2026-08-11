import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { MapPin, Ticket, Clock, Phone, Plus, X, RefreshCw, ChevronRight, Radio, Camera, Star, Share2, CheckCircle2 } from "lucide-react";

const DURATIONS = [
  { label: "15 min", ms: 15 * 60 * 1000 },
  { label: "30 min", ms: 30 * 60 * 1000 },
  { label: "1 hr", ms: 60 * 60 * 1000 },
  { label: "2 hr", ms: 120 * 60 * 1000 },
];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function timeLeft(expiresAtISO) {
  const diff = new Date(expiresAtISO).getTime() - Date.now();
  if (diff <= 0) return null;
  const mins = Math.floor(diff / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  const secs = Math.floor((diff % 60000) / 1000);
  if (m === 0) return `${secs}s`;
  return `${m}m`;
}

async function fetchProfile(id) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertProfile(profile) {
  const { data, error } = await supabase.from("profiles").upsert(profile).select().single();
  if (error) throw error;
  return data;
}

async function uploadAvatar(userId, file) {
  const ext = file.name.split(".").pop();
  const path = `${userId}/${uid()}.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
}

async function fetchActivePublicListings() {
  const { data, error } = await supabase
    .from("public_listings")
    .select("*")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function fetchMyListings(driverId) {
  const { data, error } = await supabase.from("listings").select("*").eq("driver_id", driverId).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function createListing(listing) {
  const { error } = await supabase.from("listings").insert(listing);
  if (error) throw error;
}

async function deleteListing(id) {
  const { error } = await supabase.from("listings").delete().eq("id", id);
  if (error) throw error;
}

async function fetchReveals(riderId) {
  const { data, error } = await supabase.from("reveals").select("listing_id, driver_id").eq("rider_id", riderId);
  if (error) throw error;
  return data;
}

async function redeemTicketRPC(listingId) {
  const { data, error } = await supabase.rpc("redeem_ticket", { p_listing_id: listingId });
  if (error) throw error;
  return data?.[0];
}

async function submitRatingRPC(listingId, rateeId, stars, comment) {
  const { error } = await supabase.rpc("submit_rating", {
    p_listing_id: listingId,
    p_ratee_id: rateeId,
    p_stars: stars,
    p_comment: comment || null,
  });
  if (error) throw error;
}

async function createCheckin(listingId, riderId, driverId, coords) {
  const { error } = await supabase.from("checkins").insert({
    listing_id: listingId,
    rider_id: riderId,
    driver_id: driverId,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  });
  if (error) throw error;
}

async function fetchMyCheckins(riderId) {
  const { data, error } = await supabase.from("checkins").select("listing_id").eq("rider_id", riderId);
  if (error) throw error;
  return data.map((c) => c.listing_id);
}

async function fetchMyRatings(riderId) {
  const { data, error } = await supabase.from("ratings").select("listing_id").eq("rater_id", riderId);
  if (error) throw error;
  return data.map((r) => r.listing_id);
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      setConfigError(true);
      setBooting(false);
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) {
        const p = await fetchProfile(data.session.user.id).catch(() => null);
        setProfile(p);
      }
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        const p = await fetchProfile(newSession.user.id).catch(() => null);
        setProfile(p);
      } else {
        setProfile(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  if (configError) {
    return (
      <div style={styles.bootScreen}>
        <div style={{ ...styles.card, maxWidth: 420, margin: "0 20px" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Setup needed</div>
          <div style={{ color: "#8B93A7", fontSize: 14, lineHeight: 1.6 }}>
            This app needs a Supabase URL and anon key in a <code>.env</code> file, and email OTP enabled
            in Supabase Auth settings. Check the README.
          </div>
        </div>
      </div>
    );
  }

  if (booting) {
    return (
      <div style={styles.bootScreen}>
        <div style={styles.bootPulse} />
      </div>
    );
  }

  if (!session) return <div style={styles.app}><AuthGate /></div>;
  if (!profile) return <div style={styles.app}><ProfileSetup session={session} onDone={setProfile} /></div>;

  return (
    <div style={styles.app}>
      <Dashboard profile={profile} setProfile={setProfile} onLogout={handleLogout} />
    </div>
  );
}

function AuthGate() {
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState("email");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    setErr("");
    if (!email.trim()) return setErr("Enter your email address.");
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) return setErr(error.message);
    setStage("code");
  };

  const verifyCode = async () => {
    setErr("");
    if (!code.trim()) return setErr("Enter the code from your email.");
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) return setErr(error.message);
  };

  return (
    <div style={styles.onboardWrap}>
      <div style={styles.onboardHeader}>
        <div style={styles.boardChip}>
          <Radio size={13} strokeWidth={2.5} />
          <span>LIVE ROUTE BOARD</span>
        </div>
        <h1 style={styles.brandTitle}>SLINGSHOT</h1>
        <p style={styles.brandSub}>Drivers post where they're headed. Riders catch a lift on the way.</p>
      </div>
      <div style={styles.card}>
        {stage === "email" ? (
          <>
            <label style={styles.label}>Verify your email to continue</label>
            <input style={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" />
            {err && <div style={styles.errText}>{err}</div>}
            <button style={styles.primaryBtn} onClick={sendCode} disabled={busy}>
              {busy ? "Sending…" : "Send verification code"}
              <ChevronRight size={18} />
            </button>
            <p style={styles.fineprint}>We'll email you a one-time code — no password needed.</p>
          </>
        ) : (
          <>
            <label style={styles.label}>Enter the code sent to {email}</label>
            <input style={styles.input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" />
            {err && <div style={styles.errText}>{err}</div>}
            <button style={styles.primaryBtn} onClick={verifyCode} disabled={busy}>
              {busy ? "Verifying…" : "Verify & continue"}
              <ChevronRight size={18} />
            </button>
            <button style={{ ...styles.ghostSmallBtn, marginTop: 10, width: "100%" }} onClick={() => setStage("email")}>
              Use a different email
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileSetup({ session, onDone }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("rider");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const onPickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    setErr("");
    if (!name.trim() || !phone.trim()) return setErr("Enter your name and phone number.");
    if (role === "driver" && !vehiclePlate.trim()) return setErr("Drivers need to add a vehicle plate.");
    setBusy(true);
    try {
      let photoUrl = null;
      if (photoFile) photoUrl = await uploadAvatar(session.user.id, photoFile);
      const saved = await upsertProfile({
        id: session.user.id,
        email: session.user.email,
        name: name.trim(),
        phone: phone.replace(/\s+/g, ""),
        role,
        photo_url: photoUrl,
        vehicle_plate: role === "driver" ? vehiclePlate.trim().toUpperCase() : null,
        vehicle_model: role === "driver" ? vehicleModel.trim() || null : null,
        vehicle_color: role === "driver" ? vehicleColor.trim() || null : null,
      });
      onDone(saved);
    } catch (e) {
      console.error(e);
      setErr("Couldn't save your profile. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.onboardWrap}>
      <div style={styles.onboardHeader}>
        <h1 style={{ ...styles.brandTitle, fontSize: 34 }}>ONE MORE STEP</h1>
        <p style={styles.brandSub}>Your email's verified. Now set up your profile.</p>
      </div>
      <div style={styles.card}>
        <label style={styles.label}>Photo (recommended — riders and drivers can see who they're meeting)</label>
        <div style={styles.photoRow}>
          <div style={styles.photoPreview}>
            {photoPreview ? <img src={photoPreview} alt="" style={styles.photoImg} /> : <Camera size={20} color="#5C6584" />}
          </div>
          <label style={styles.uploadBtn}>
            Choose photo
            <input type="file" accept="image/*" onChange={onPickPhoto} style={{ display: "none" }} />
          </label>
        </div>

        <label style={styles.label}>Your name</label>
        <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wanjiru Kamau" />
        <label style={styles.label}>Phone number</label>
        <input style={styles.input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX" inputMode="tel" />

        <label style={styles.label}>I am a</label>
        <div style={styles.roleToggle}>
          <button onClick={() => setRole("rider")} style={{ ...styles.roleBtn, ...(role === "rider" ? styles.roleBtnActive("#14B8A6") : {}) }}>Rider</button>
          <button onClick={() => setRole("driver")} style={{ ...styles.roleBtn, ...(role === "driver" ? styles.roleBtnActive("#F5B301") : {}) }}>Driver</button>
        </div>

        {role === "driver" && (
          <>
            <label style={styles.label}>Vehicle plate</label>
            <input style={styles.input} value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} placeholder="e.g. KDA 123X" />
            <label style={styles.label}>Model & color (optional)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...styles.input, flex: 1 }} value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} placeholder="e.g. Toyota Fielder" />
              <input style={{ ...styles.input, flex: 1 }} value={vehicleColor} onChange={(e) => setVehicleColor(e.target.value)} placeholder="e.g. Silver" />
            </div>
          </>
        )}

        {err && <div style={styles.errText}>{err}</div>}
        <button style={styles.primaryBtn} onClick={submit} disabled={busy}>
          {busy ? "Saving…" : "Finish setup"}
          <ChevronRight size={18} />
        </button>
        <p style={styles.fineprint}>New accounts start with 5 free tickets.</p>
      </div>
    </div>
  );
}

function Dashboard({ profile, setProfile, onLogout }) {
  const refreshProfile = useCallback(async () => {
    const fresh = await fetchProfile(profile.id);
    if (fresh) setProfile(fresh);
  }, [profile.id, setProfile]);

  return (
    <div style={styles.dashWrap}>
      <TopBar profile={profile} onLogout={onLogout} />
      {profile.role === "driver" ? <DriverView profile={profile} /> : <RiderView profile={profile} setProfile={setProfile} refreshProfile={refreshProfile} />}
    </div>
  );
}

function TopBar({ profile, onLogout }) {
  return (
    <div style={styles.topBar}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {profile.photo_url && <img src={profile.photo_url} alt="" style={styles.avatarSm} />}
        <div>
          <div style={styles.topBarBrand}>SLINGSHOT</div>
          <div style={styles.topBarUser}>
            {profile.name} · <span style={{ color: profile.role === "driver" ? "#F5B301" : "#14B8A6" }}>{profile.role === "driver" ? "Driver" : "Rider"}</span>
          </div>
        </div>
      </div>
      <div style={styles.topBarRight}>
        <div style={styles.ticketPill}>
          <Ticket size={14} strokeWidth={2.5} />
          <span>{profile.tickets ?? 0}</span>
        </div>
        <button style={styles.ghostSmallBtn} onClick={onLogout}>Sign out</button>
      </div>
    </div>
  );
}

function DriverView({ profile }) {
  const [showForm, setShowForm] = useState(false);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState(DURATIONS[1]);
  const [myListings, setMyListings] = useState([]);
  const [, forceTick] = useState(0);
  const [posting, setPosting] = useState(false);

  const loadMine = useCallback(async () => {
    try {
      setMyListings(await fetchMyListings(profile.id));
    } catch (e) {
      console.error(e);
    }
  }, [profile.id]);

  useEffect(() => {
    loadMine();
    const iv = setInterval(loadMine, 5000);
    const tickIv = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => { clearInterval(iv); clearInterval(tickIv); };
  }, [loadMine]);

  const postListing = async () => {
    if (!origin.trim() || !destination.trim() || posting) return;
    setPosting(true);
    try {
      await createListing({
        id: uid(),
        driver_id: profile.id,
        origin: origin.trim(),
        destination: destination.trim(),
        notes: notes.trim() || null,
        expires_at: new Date(Date.now() + duration.ms).toISOString(),
      });
      setOrigin(""); setDestination(""); setNotes(""); setShowForm(false);
      loadMine();
    } catch (e) {
      console.error(e);
      alert("Couldn't post listing. Check your connection and try again.");
    } finally {
      setPosting(false);
    }
  };

  const endListing = async (id) => {
    try { await deleteListing(id); loadMine(); } catch (e) { console.error(e); }
  };

  return (
    <div style={styles.viewWrap}>
      {!profile.vehicle_plate && (
        <div style={styles.warnBanner}>Add your vehicle plate in your profile before posting — riders need to know what to look for.</div>
      )}
      {!showForm ? (
        <button style={styles.postBtn} onClick={() => setShowForm(true)}>
          <Plus size={18} /> Post your route
        </button>
      ) : (
        <div style={styles.card}>
          <div style={styles.cardHeadRow}>
            <span style={styles.cardHeadTitle}>New listing</span>
            <button style={styles.iconBtn} onClick={() => setShowForm(false)}><X size={16} /></button>
          </div>
          <label style={styles.label}>Starting from</label>
          <input style={styles.input} value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="e.g. Nairobi CBD, Tom Mboya St" />
          <label style={styles.label}>Headed to</label>
          <input style={styles.input} value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Rongai, Prison Stage" />
          <label style={styles.label}>Route notes (optional)</label>
          <input style={styles.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. via Langata Rd, one stop only" />
          <label style={styles.label}>Listing stays active for</label>
          <div style={styles.durationRow}>
            {DURATIONS.map((d) => (
              <button key={d.label} onClick={() => setDuration(d)} style={{ ...styles.durationBtn, ...(duration.label === d.label ? styles.durationBtnActive : {}) }}>{d.label}</button>
            ))}
          </div>
          <button style={styles.primaryBtn} onClick={postListing} disabled={posting}>
            {posting ? "Posting…" : "Post to board"} <ChevronRight size={18} />
          </button>
        </div>
      )}

      <div style={styles.sectionLabel}>Your active listings</div>
      {myListings.filter((l) => timeLeft(l.expires_at)).length === 0 && (
        <div style={styles.emptyState}>Nothing posted yet. Riders can only find you once you post a route.</div>
      )}
      {myListings.map((l) => {
        const left = timeLeft(l.expires_at);
        if (!left) return null;
        return (
          <div key={l.id} style={styles.boardRow}>
            <div style={styles.boardRowMain}>
              <div style={styles.boardDest}>{l.destination}</div>
              <div style={styles.boardOrigin}>from {l.origin}</div>
              {l.notes && <div style={styles.boardNotes}>{l.notes}</div>}
            </div>
            <div style={styles.boardRowSide}>
              <div style={styles.boardTimer}><Clock size={12} />{left}</div>
              <button style={styles.endBtn} onClick={() => endListing(l.id)}>End</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RiderView({ profile, setProfile, refreshProfile }) {
  const [listings, setListings] = useState([]);
  const [reveals, setReveals] = useState([]);
  const [checkedIn, setCheckedIn] = useState([]);
  const [ratedIds, setRatedIds] = useState([]);
  const [, forceTick] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [ratingFor, setRatingFor] = useState(null);

  const load = useCallback(async () => {
    try {
      const [active, rev, chk, rated] = await Promise.all([
        fetchActivePublicListings(),
        fetchReveals(profile.id),
        fetchMyCheckins(profile.id),
        fetchMyRatings(profile.id),
      ]);
      setListings(active);
      setReveals(rev);
      setCheckedIn(chk);
      setRatedIds(rated);
    } catch (e) {
      console.error(e);
    }
  }, [profile.id]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    const tickIv = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => { clearInterval(iv); clearInterval(tickIv); };
  }, [load]);

  const revealedMap = Object.fromEntries(reveals.map((r) => [r.listing_id, r.driver_id]));

  const revealContact = async (listing) => {
    if (revealedMap[listing.id] || busyId) return;
    setBusyId(listing.id);
    try {
      const result = await redeemTicketRPC(listing.id);
      if (!result) throw new Error("No response from server");
      await refreshProfile();
      await load();
    } catch (e) {
      console.error(e);
      alert(e.message || "Couldn't unlock contact. Check your ticket balance and connection.");
    } finally {
      setBusyId(null);
    }
  };

  const [revealedPhones, setRevealedPhones] = useState({});
  useEffect(() => {
    (async () => {
      const toFetch = reveals.filter((r) => !revealedPhones[r.listing_id]);
      for (const r of toFetch) {
        try {
          const result = await redeemTicketRPC(r.listing_id);
          if (result) setRevealedPhones((prev) => ({ ...prev, [r.listing_id]: result.driver_phone }));
        } catch (e) {
          console.error(e);
        }
      }
    })();
  }, [reveals]); // eslint-disable-line react-hooks/exhaustive-deps

  const doCheckin = async (listing) => {
    let coords = null;
    try {
      if (navigator.geolocation) {
        coords = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => resolve(null),
            { timeout: 4000 }
          );
        });
      }
    } catch {
      coords = null;
    }
    try {
      await createCheckin(listing.id, profile.id, listing.driver_id, coords);
      setCheckedIn((c) => [...c, listing.id]);
    } catch (e) {
      console.error(e);
      alert("Couldn't check in. Try again.");
    }
  };

  const shareTrip = (listing) => {
    const phone = revealedPhones[listing.id];
    const msg = `I'm riding with ${listing.driver_name} (${listing.vehicle_plate || "plate not given"}, ${listing.vehicle_color || ""} ${listing.vehicle_model || ""}) from ${listing.origin} to ${listing.destination}. Driver's contact: ${phone || "n/a"}.`;
    window.location.href = `sms:?body=${encodeURIComponent(msg)}`;
  };

  return (
    <div style={styles.viewWrap}>
      <div style={styles.sectionRow}>
        <div style={styles.sectionLabel}>Drivers on the board now</div>
        <button style={styles.refreshBtn} onClick={load}><RefreshCw size={13} /></button>
      </div>

      {listings.length === 0 && <div style={styles.emptyState}>No active drivers right now. The board updates automatically — check back shortly.</div>}

      {listings.map((l) => {
        const left = timeLeft(l.expires_at);
        if (!left) return null;
        const isRevealed = !!revealedMap[l.id];
        const phone = revealedPhones[l.id];
        const isCheckedIn = checkedIn.includes(l.id);
        const isRated = ratedIds.includes(l.id);

        return (
          <div key={l.id} style={styles.boardRow}>
            <div style={styles.boardRowMain}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {l.driver_photo && <img src={l.driver_photo} alt="" style={styles.avatarSm} />}
                <div style={styles.boardDest}>{l.destination}</div>
              </div>
              <div style={styles.boardOrigin}>
                from {l.origin} · {l.driver_name}
                {l.driver_rating && (
                  <span style={styles.ratingInline}> · <Star size={11} fill="#F5B301" color="#F5B301" style={{ verticalAlign: "-1px" }} /> {l.driver_rating} ({l.driver_rating_count})</span>
                )}
              </div>
              {l.notes && <div style={styles.boardNotes}>{l.notes}</div>}
              {isRevealed && (
                <div style={styles.revealBox}>
                  {phone && <div style={styles.revealedPhone}><Phone size={13} />{phone}</div>}
                  {l.vehicle_plate && <div style={styles.vehicleLine}>{l.vehicle_plate} · {l.vehicle_color} {l.vehicle_model}</div>}
                  <div style={styles.revealActions}>
                    {!isCheckedIn ? (
                      <button style={styles.smallActionBtn} onClick={() => doCheckin(l)}><CheckCircle2 size={12} />Check in</button>
                    ) : (
                      <span style={styles.checkedInTag}><CheckCircle2 size={12} />Checked in</span>
                    )}
                    <button style={styles.smallActionBtn} onClick={() => shareTrip(l)}><Share2 size={12} />Share trip</button>
                    {!isRated && (
                      <button style={styles.smallActionBtn} onClick={() => setRatingFor(l)}><Star size={12} />Rate</button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div style={styles.boardRowSide}>
              <div style={styles.boardTimer}><Clock size={12} />{left}</div>
              {!isRevealed ? (
                <button style={styles.revealBtn} onClick={() => revealContact(l)} disabled={busyId === l.id}>
                  <Ticket size={13} />{busyId === l.id ? "…" : "Reveal · 1"}
                </button>
              ) : (
                <div style={styles.revealedTag}>Unlocked</div>
              )}
            </div>
          </div>
        );
      })}

      {ratingFor && (
        <RatingModal
          listing={ratingFor}
          onClose={() => setRatingFor(null)}
          onSubmit={async (stars, comment) => {
            try {
              await submitRatingRPC(ratingFor.id, ratingFor.driver_id, stars, comment);
              setRatedIds((r) => [...r, ratingFor.id]);
            } catch (e) {
              console.error(e);
              alert("Couldn't submit rating.");
            } finally {
              setRatingFor(null);
            }
          }}
        />
      )}
    </div>
  );
}

function RatingModal({ listing, onClose, onSubmit }) {
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.cardHeadRow}>
          <span style={styles.cardHeadTitle}>Rate {listing.driver_name}</span>
          <button style={styles.iconBtn} onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ display: "flex", gap: 6, margin: "16px 0" }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setStars(n)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              <Star size={28} fill={n <= stars ? "#F5B301" : "none"} color="#F5B301" />
            </button>
          ))}
        </div>
        <input style={styles.input} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment" />
        <button style={styles.primaryBtn} onClick={() => onSubmit(stars, comment)}>Submit rating</button>
      </div>
    </div>
  );
}

const styles = {
  app: { minHeight: "100vh", background: "#0B1220", fontFamily: "'IBM Plex Sans', sans-serif", color: "#EDEFF3" },
  bootScreen: { minHeight: "100vh", background: "#0B1220", display: "flex", alignItems: "center", justifyContent: "center" },
  bootPulse: { width: 40, height: 40, borderRadius: "50%", background: "#F5B301", opacity: 0.8 },
  onboardWrap: { maxWidth: 440, margin: "0 auto", padding: "48px 20px 40px" },
  onboardHeader: { textAlign: "center", marginBottom: 28 },
  boardChip: { display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(245,179,1,0.12)", color: "#F5B301", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.12em", padding: "5px 10px", borderRadius: 999, border: "1px solid rgba(245,179,1,0.35)", marginBottom: 16 },
  brandTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, letterSpacing: "0.06em", margin: 0, color: "#F5F7FA", lineHeight: 1 },
  brandSub: { color: "#8B93A7", fontSize: 15, marginTop: 10, lineHeight: 1.5 },
  card: { background: "#131B2E", border: "1px solid #223049", borderRadius: 16, padding: 22 },
  label: { display: "block", fontSize: 12, color: "#8B93A7", marginBottom: 6, marginTop: 16, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" },
  input: { width: "100%", boxSizing: "border-box", background: "#0B1220", border: "1px solid #2A3A5C", borderRadius: 10, padding: "12px 14px", color: "#EDEFF3", fontSize: 15, fontFamily: "'IBM Plex Sans', sans-serif", outline: "none" },
  roleToggle: { display: "flex", gap: 8 },
  roleBtn: { flex: 1, padding: "12px 0", borderRadius: 10, border: "1px solid #2A3A5C", background: "#0B1220", color: "#8B93A7", fontWeight: 600, fontSize: 14, cursor: "pointer" },
  roleBtnActive: (color) => ({ borderColor: color, color: "#0B1220", background: color }),
  errText: { color: "#F87171", fontSize: 13, marginTop: 12 },
  primaryBtn: { width: "100%", marginTop: 20, padding: "14px 0", background: "#F5B301", color: "#0B1220", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
  fineprint: { fontSize: 11.5, color: "#5C6584", marginTop: 14, lineHeight: 1.5, textAlign: "center" },
  dashWrap: { maxWidth: 520, margin: "0 auto", paddingBottom: 60 },
  topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", borderBottom: "1px solid #1A2438", position: "sticky", top: 0, background: "#0B1220", zIndex: 10 },
  topBarBrand: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.08em", color: "#F5F7FA" },
  topBarUser: { fontSize: 12, color: "#8B93A7", marginTop: 2 },
  topBarRight: { display: "flex", alignItems: "center", gap: 8 },
  ticketPill: { display: "flex", alignItems: "center", gap: 5, background: "rgba(20,184,166,0.14)", color: "#2DD4BF", padding: "6px 10px", borderRadius: 999, fontSize: 13, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" },
  ghostSmallBtn: { background: "transparent", border: "1px solid #2A3A5C", color: "#8B93A7", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" },
  viewWrap: { padding: "20px 20px 0" },
  warnBanner: { background: "rgba(245,179,1,0.1)", border: "1px solid rgba(245,179,1,0.3)", color: "#F5B301", fontSize: 12.5, padding: "10px 14px", borderRadius: 10, marginBottom: 16, lineHeight: 1.5 },
  postBtn: { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#F5B301", color: "#0B1220", border: "none", borderRadius: 12, padding: "16px 0", fontWeight: 700, fontSize: 15, cursor: "pointer", marginBottom: 24 },
  cardHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  cardHeadTitle: { fontWeight: 700, fontSize: 15 },
  iconBtn: { background: "transparent", border: "none", color: "#8B93A7", cursor: "pointer", padding: 4 },
  durationRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  durationBtn: { padding: "9px 14px", borderRadius: 8, border: "1px solid #2A3A5C", background: "#0B1220", color: "#8B93A7", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  durationBtnActive: { borderColor: "#F5B301", color: "#F5B301", background: "rgba(245,179,1,0.1)" },
  sectionLabel: { fontSize: 12, fontWeight: 700, color: "#8B93A7", textTransform: "uppercase", letterSpacing: "0.06em", margin: "24px 0 12px" },
  sectionRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  refreshBtn: { background: "transparent", border: "1px solid #2A3A5C", color: "#8B93A7", borderRadius: 8, padding: "6px 8px", cursor: "pointer", marginTop: "24px" },
  emptyState: { color: "#5C6584", fontSize: 13.5, padding: "24px 16px", textAlign: "center", border: "1px dashed #223049", borderRadius: 12, lineHeight: 1.5 },
  boardRow: { display: "flex", justifyContent: "space-between", gap: 12, background: "#131B2E", border: "1px solid #1E2A44", borderLeft: "3px solid #F5B301", borderRadius: 10, padding: "14px 16px", marginBottom: 10 },
  boardRowMain: { flex: 1, minWidth: 0 },
  boardDest: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: "0.03em", color: "#F5F7FA", lineHeight: 1.1 },
  boardOrigin: { fontSize: 12.5, color: "#8B93A7", marginTop: 4 },
  boardNotes: { fontSize: 12, color: "#5C6584", marginTop: 4, fontStyle: "italic" },
  ratingInline: { color: "#F5B301" },
  revealBox: { marginTop: 10, paddingTop: 10, borderTop: "1px solid #1E2A44" },
  revealedPhone: { display: "flex", alignItems: "center", gap: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "#2DD4BF", fontWeight: 600 },
  vehicleLine: { fontSize: 12, color: "#8B93A7", marginTop: 4, fontFamily: "'IBM Plex Mono', monospace" },
  revealActions: { display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" },
  smallActionBtn: { display: "flex", alignItems: "center", gap: 4, background: "#0B1220", border: "1px solid #2A3A5C", color: "#8B93A7", borderRadius: 7, padding: "5px 9px", fontSize: 11, cursor: "pointer" },
  checkedInTag: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#2DD4BF", fontWeight: 600 },
  boardRowSide: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 },
  boardTimer: { display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#F5B301", fontFamily: "'IBM Plex Mono', monospace" },
  endBtn: { background: "transparent", border: "1px solid #3A2A2A", color: "#F87171", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" },
  revealBtn: { display: "flex", alignItems: "center", gap: 5, background: "rgba(20,184,166,0.14)", border: "1px solid #14B8A6", color: "#2DD4BF", borderRadius: 8, padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" },
  revealedTag: { fontSize: 11.5, color: "#2DD4BF", fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" },
  avatarSm: { width: 26, height: 26, borderRadius: "50%", objectFit: "cover", border: "1px solid #2A3A5C" },
  photoRow: { display: "flex", alignItems: "center", gap: 14, marginTop: 8 },
  photoPreview: { width: 56, height: 56, borderRadius: "50%", background: "#0B1220", border: "1px solid #2A3A5C", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoImg: { width: "100%", height: "100%", objectFit: "cover" },
  uploadBtn: { background: "transparent", border: "1px solid #2A3A5C", color: "#8B93A7", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, cursor: "pointer" },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 },
};
