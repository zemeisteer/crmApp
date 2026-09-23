async function run() {
  const baseUrl = "http://localhost:4000/api";

  console.log("=== 1. Register new center (Start for free) ===");
  const rand = Math.floor(Math.random() * 100000);
  const email = `owner_${rand}@bilimdon.uz`;
  const regRes = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      centerName: "Bilimdon Academy",
      fullName: "Azizbek Sattorov",
      email,
      password: "Password123",
    }),
  }).then((r) => r.json());

  console.log("Registered tenant:", regRes.tenant?.name, "Role:", regRes.user?.role, "Step:", regRes.tenant?.onboardingStep);
  if (regRes.user?.role !== "OWNER") throw new Error("Expected user role to be OWNER");

  const ownerToken = regRes.accessToken;
  const ownerHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ownerToken}`,
  };

  console.log("\n=== 2. Onboarding state ===");
  const stateRes = await fetch(`${baseUrl}/onboarding/state`, { headers: ownerHeaders }).then((r) => r.json());
  console.log("State step:", stateRes.tenant?.onboardingStep, "Counts:", stateRes.counts);

  console.log("\n=== 3. Check reserved subdomains ===");
  const reservedRes = await fetch(`${baseUrl}/onboarding/check-subdomain`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ subdomain: "admin" }),
  }).then((r) => r.json());
  console.log("Subdomain 'admin' available:", reservedRes.available, "Reason:", reservedRes.reason);
  if (reservedRes.available) throw new Error("admin should be reserved!");

  console.log("\n=== 4. Check & update valid Workspace URL ===");
  const customSlug = `bilimdon-center-${rand}`;
  const validRes = await fetch(`${baseUrl}/onboarding/check-subdomain`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ subdomain: customSlug }),
  }).then((r) => r.json());
  console.log(`Subdomain '${customSlug}' available:`, validRes.available);
  if (!validRes.available) throw new Error("Custom slug should be available!");

  const updateWsRes = await fetch(`${baseUrl}/onboarding/workspace`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ subdomain: customSlug }),
  }).then((r) => r.json());
  console.log("Updated subdomain to:", updateWsRes.tenant?.subdomain, "Next step:", updateWsRes.nextStep);

  console.log("\n=== 5. Multi-select teaching categories ===");
  const catRes = await fetch(`${baseUrl}/onboarding/categories`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ categories: ["languages", "mathematics", "it"] }),
  }).then((r) => r.json());
  console.log("Categories saved:", catRes.tenant?.teachingCategories, "Next step:", catRes.nextStep);

  console.log("\n=== 6. Real domain Subjects and Courses ===");
  const subjectsBulkRes = await fetch(`${baseUrl}/subjects/bulk`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      subjects: [
        { name: "Ingliz tili", courses: ["General English", "IELTS Intensive", "CEFR B2"] },
        { name: "Matematika", courses: ["Asosiy Matematika", "SAT Math"] },
      ],
    }),
  }).then((r) => r.json());
  console.log("Created subjects count:", subjectsBulkRes.length);

  console.log("\n=== 7. Create teacher invitation ===");
  const teacherEmail = `teacher_${rand}@test.uz`;
  const invRes = await fetch(`${baseUrl}/invitations`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ role: "TEACHER", email: teacherEmail }),
  }).then((r) => r.json());
  console.log("Teacher invitation created. Token:", invRes.token?.slice(0, 10) + "...", "URL:", invRes.inviteUrl);

  console.log("\n=== 8. Validate invitation publicly ===");
  const validateRes = await fetch(`${baseUrl}/invitations/${invRes.token}/validate`).then((r) => r.json());
  console.log("Public validation:", validateRes);
  if (!validateRes.valid || validateRes.role !== "TEACHER") throw new Error("Invitation validation failed!");

  console.log("\n=== 9. Accept invitation as new teacher ===");
  const acceptRes = await fetch(`${baseUrl}/invitations/${invRes.token}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "Teacher Dilshod", password: "Password123" }),
  }).then((r) => r.json());
  console.log("Accepted invite:", acceptRes.user?.fullName, "Role:", acceptRes.user?.role, "Redirect:", acceptRes.redirectUrl);
  if (acceptRes.redirectUrl !== "/dashboard") throw new Error("Staff should redirect to /dashboard");

  console.log("\n=== 10. Single-use invitation protection ===");
  const replayRes = await fetch(`${baseUrl}/invitations/${invRes.token}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "Teacher Dilshod", password: "Password123" }),
  });
  console.log("Replay attempt status code:", replayRes.status);
  if (replayRes.status !== 400) throw new Error("Replaying invitation must return 400 Bad Request");
  const replayBody = await replayRes.json();
  console.log("Replay rejection message:", replayBody.message);

  console.log("\n=== 11. Multi-organization membership & workspace switching ===");
  // Create a 2nd education center
  const owner2Email = `owner2_${rand}@oxford.uz`;
  const center2Res = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      centerName: "Oxford Academy",
      fullName: "Owner Two",
      email: owner2Email,
      password: "Password123",
    }),
  }).then((r) => r.json());

  // Center 2 invites Teacher Dilshod as a STUDENT
  const invStudentRes = await fetch(`${baseUrl}/invitations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${center2Res.accessToken}`,
    },
    body: JSON.stringify({ role: "STUDENT", email: teacherEmail }),
  }).then((r) => r.json());

  // Dilshod accepts the student invite (already exists, no password needed)
  const acceptStudentRes = await fetch(`${baseUrl}/invitations/${invStudentRes.token}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).then((r) => r.json());
  console.log("Teacher joined Center 2 as STUDENT. Redirect:", acceptStudentRes.redirectUrl);
  if (acceptStudentRes.redirectUrl !== "/portal") throw new Error("Student should redirect to /portal");

  // Now login as Dilshod: has TEACHER at Center 1 and STUDENT at Center 2!
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: teacherEmail, password: "Password123" }),
  }).then((r) => r.json());

  console.log("Login requires workspace selection:", loginRes.requiresWorkspaceSelection);
  console.log("Available workspaces:", loginRes.workspaces);
  if (!loginRes.requiresWorkspaceSelection || loginRes.workspaces?.length !== 2) {
    throw new Error("Expected login to return 2 workspaces!");
  }

  // Switch to Center 1 as Teacher
  const select1 = await fetch(`${baseUrl}/auth/select-workspace`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${acceptStudentRes.accessToken}`,
    },
    body: JSON.stringify({ tenantId: regRes.tenant.id }),
  }).then((r) => r.json());
  console.log("Switched to Center 1, role:", select1.user?.role, "Tenant:", select1.tenant?.name);
  if (select1.user?.role !== "TEACHER") throw new Error("Expected role TEACHER in Center 1");

  // Switch to Center 2 as Student
  const select2 = await fetch(`${baseUrl}/auth/select-workspace`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${select1.accessToken}`,
    },
    body: JSON.stringify({ tenantId: center2Res.tenant.id }),
  }).then((r) => r.json());
  console.log("Switched to Center 2, role:", select2.user?.role, "Tenant:", select2.tenant?.name);
  if (select2.user?.role !== "STUDENT") throw new Error("Expected role STUDENT in Center 2");

  console.log("\n==================================================");
  console.log("🎉 ALL 11 END-TO-END VERIFICATION CHECKS PASSED! 🎉");
  console.log("==================================================");
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
