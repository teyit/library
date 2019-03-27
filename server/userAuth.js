"use strict";

const passport = require("passport");
const session = require("express-session");
const md5 = require("md5");
const GoogleStrategy = require("passport-google-oauth20");

const log = require("./logger");
const { stringTemplate: template } = require("./utils");

const router = require("express-promise-router")();
const domains = new Set(process.env.APPROVED_DOMAINS.split(/,\s?/g));

passport.use(
  new GoogleStrategy.Strategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.REDIRECT_URI
        ? process.env.REDIRECT_URI
        : "/auth/redirect",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
      passReqToCallback: true
    },
    (request, accessToken, refreshToken, profile, done) => done(null, profile)
  )
);

router.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: true,
    saveUninitialized: true
  })
);

router.use(passport.initialize());
router.use(passport.session());

// seralize/deseralization methods for extracting user information from the
// session cookie and adding it to the req.passport object
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

router.get(
  "/login",
  passport.authenticate("google", {
    scope: [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile"
    ],
    prompt: "select_account"
  })
);

router.get("/logout", (req, res) => {
  req.logout();
  res.redirect("/");
});

router.get("/auth/redirect", passport.authenticate("google"), (req, res) => {
  res.redirect(req.session.authRedirect || "/");
});

router.use((req, res, next) => {
  const isDev = process.env.NODE_ENV === "development";
  const authenticated = req.isAuthenticated();

  const passportUser = (req.session.passport || {}).user || {};
  const [{ value: userEmail = "" } = {}] = passportUser.emails || [];
  const [userDomain] = userEmail.split("@").slice(-1);

  if (isDev || (authenticated && domains.has(userDomain))) {
    setUserInfo(req);
    return next();
  }

  if (authenticated && !domains.has(userDomain)) {
    return next(Error("Unauthorized"));
  }

  log.info("User not authenticated");
  req.session.authRedirect = req.path;
  res.redirect("/login");
});

function setUserInfo(req) {
  if (process.env.NODE_ENV === "development") {
    req.userInfo = {
      email: process.env.TEST_EMAIL || template("footer.defaultEmail"),
      userId: "10",
      analyticsUserId: md5("10library")
    };
    return;
  }
  req.userInfo = req.userInfo
    ? req.userInfo
    : {
        email: req.session.passport.user.emails[0].value,
        userId: req.session.passport.user.id,
        analyticsUserId: md5(req.session.passport.user.id + "library")
      };
}

module.exports = router;
