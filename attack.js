import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";

// Load the 10,000 forged users into k6 memory perfectly
const users = new SharedArray("users", function () {
  return JSON.parse(open("./users.json"));
});

export const options = {
  scenarios: {
    flash_sale_spike: {
      executor: "shared-iterations",
      vus: 10, // 1,000 Virtual Users firing at the exact same time
      iterations: 10, // 10,000 total requests
      maxDuration: "30s", // Cut off if the server hangs longer than 30s
    },
  },
};

export default function () {
  // Grab a unique user based on the current loop iteration
  const userIndex = exec.scenario.iterationInTest;
  const user = users[userIndex];

  // ⚠️ Change this URL to your local worker or production URL!
  // Assuming Product ID is 3
  const url = "http://localhost:8787/api/v1/product/checkout/6";

  const params = {
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
    },
  };

  // The users smash the buy button
  const res = http.post(url, "{}", params);

  // The Scoreboard: Check if the logic held up
  check(res, {
    "🏆 WINNER (202 Accepted)": (r) => r.status === 202,
    "❌ LOSER (400 Out of Stock)": (r) => r.status === 400,
    "🔥 CRASH (500+ Server Error)": (r) => r.status >= 500,
  });
}
