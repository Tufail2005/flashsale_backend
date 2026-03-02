import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";

// Load the 10,000 forged users
const users = new SharedArray("users", function () {
  return JSON.parse(open("./users.json"));
});

export const options = {
  scenarios: {
    flash_sale_spike: {
      executor: "shared-iterations",
      //  burn rate
      vus: 200,
      iterations: 10000,
      maxDuration: "2m", // Give it plenty of time
    },
  },
};

export default function () {
  const userIndex = exec.scenario.iterationInTest;
  const user = users[userIndex];

  const url =
    "https://flashsalebackend.gudduahmedansari786.workers.dev/api/v1/product/checkout/13";

  const params = {
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
    },
  };

  // Increase the random delay up to 2 seconds
  sleep(Math.random() * 1.5);

  const res = http.post(url, "{}", params);

  // Print to the terminal only if they win!
  if (res.status === 202) {
    console.log(
      `✅ WINNER! User ID [${user.id}] successfully claimed the item!`
    );
  }

  check(res, {
    "🏆 WINNER (202 Accepted)": (r) => r.status === 202,
    "❌ LOSER (400 Out of Stock)": (r) => r.status === 400,
    "🔥 CRASH (500+ Server Error)": (r) => r.status >= 500,
  });
}
