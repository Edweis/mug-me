const express = require("express");
const axios = require("axios");
const pug = require("pug");
const cheerio = require("cheerio");
const _ = require("lodash");
const numeral = require("numeral");
const moment = require("moment");
const auth = require("./github_creds");

const app = express();
const port = 3000;
const apiUrl = "https://api.github.com";
const siteUrl = "https://github.com";
const config = { auth };
const templater = pug.compileFile("views/main.pug");

const cache = {};
let apiCallCount = 0;
let apiCallSaved = 0;
let siteCallCount = 0;
async function axiosCache(url, withHeader = false) {
  let result;
  if (cache[url]) {
    apiCallSaved += 1;
    result = cache[url];
  } else {
    result = await axios.get(url, config);
    cache[url] = result;
    if (url.includes(apiUrl)) apiCallCount += 1;
    else siteCallCount += 1;
  }
  if (withHeader) return result;
  return result.data;
}

function getContributionCount(html) {
  const $ = cheerio.load(html);
  const contributionRaw = $("div.js-yearly-contributions > div > h2").text();
  const contribution = contributionRaw
    .substring(0, contributionRaw.indexOf("contribution"))
    .trim()
    .replace(",", "")
    .replace(".", "");
  return contribution;
}

function getBio(apiResponse) {
  return apiResponse.bio;
}

function getNavInfos(html) {
  const $ = cheerio.load(html);
  const navRaw = $("nav.UnderlineNav-body > a")
    .map((i, el) => {
      const values = el.children
        .map(c => {
          if (c.data) return c.data.trim().toLowerCase();
          return c.children[0].data.trim();
        })
        .filter(v => v);
      return { [values[0]]: numeral(values[1]).format("0,0a") || null };
    })
    .get();
  const mergeNav = _.merge(...navRaw);
  return mergeNav;
}

async function getWatcherCount(apiResponse) {
  const repos = await axiosCache(apiResponse.repos_url);
  const reposTotal = repos.reduce((a, r) => r.watchers_count + a, 0);
  return numeral(reposTotal).format("0,0a");
}

const getLatestCommit = async (data, headers) => {
  if (!headers.link) return data.splice(-1)[0];
  const pageOneUrl = headers.link
    .split(",")[1]
    .split(";")[0]
    .split("<")[1]
    .split(">")[0];
  const latestCommits = await axiosCache(pageOneUrl);
  return latestCommits.splice(-1)[0];
};

async function getLatestCommitInRepo(repo) {
  const { data, headers } = await axiosCache(
    repo.git_commits_url.replace("{/sha}", "").replace("/git", ""),
    true
  );
  return getLatestCommit(data, headers);
}

async function getFirstCommitDate(apiResponse) {
  const repos = await axiosCache(apiResponse.repos_url);

  const getCommitDate = async url => {
    const html = await axiosCache(url);
    const $ = cheerio.load(html);
    const tag = $("div.commit-meta > div > relative-time");
    return moment(tag.attr("datetime"));
  };

  const commitDates = repos.map(async repo => {
    const latestCommit = await getLatestCommitInRepo(repo);
    const date = await getCommitDate(latestCommit.html_url);
    // const url = `${apiUrl}/repos/${user}/${repo.xxx}/compare/${firstcommit.sha}...${latestCommit.sha}`;

    // const repoCommitCount = await axiosCache();
    return date;
  });

  const resolvedDates = await Promise.all(commitDates);
  return moment.min(resolvedDates).toDate();
}

async function getCommitCount(apiResponse) {}

async function getUserDetails(user) {
  const githubResponse = await axiosCache(`${apiUrl}/users/${user}`);
  const profilePage = await axiosCache(`${siteUrl}/${user}`);
  const yearlyContributionCount = getContributionCount(profilePage);
  const description = getBio(githubResponse);
  const { stars, followers, repositories } = getNavInfos(profilePage);
  const watcherCount = await getWatcherCount(githubResponse);
  const firstCommitDate = await getFirstCommitDate(githubResponse); // 50 calls !

  // const commitCount = await getCommitCount();
  // const organizations = await getOrganizations();

  return {
    user,
    yearlyContributionCount,
    description,
    starCount: stars,
    watcherCount,
    firstCommitDate,
    followerCount: followers
  };
}

getUserDetails("ornicar")
  .then(console.info)
  .then(() => {
    console.warn(`Api calls : ${apiCallCount}`);
    console.warn(`Site calls : ${siteCallCount}`);
    console.warn(`Api calls saved : ${apiCallSaved}`);
  });
// .then(console.debug)
// .catch(console.error);

app.get("/?:user", async (req, res, next) => {
  const { user } = req.params || "ornicar";
  try {
    // const organizationDetails = await axiosCache(githubResponse.organizations_url)
    // const organizations = organizationDetails.map(o=>o.login)
    // const repos = await axiosCache(githubResponse.repos)
    // const watcherCount = repos.reduce((a, v) => a + v.watchers_count)
    // const starCount = repos.reduce((a, v) => a + v.stargazers_count)
    const details = await getUserDetails(user);
    res.json(details);
  } catch (e) {
    console.debug(e);
  }
  // console.log(githubResponse.status)
  // const templated = templater({
  //   title: 'MugMe',
  //   username: user,
  //   description: githubResponse.bio,
  //   starCount,
  //   watcherCount,
  //   followerCount: githubResponse.followers,
  //   commitCount: '',
  //   speed: '',
  //   organizations,
  // })
  // res.send(templated)
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
