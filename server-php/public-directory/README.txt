QMail public user directory - server deployment
================================================
Contract and design: docs/fab.cons_plan.txt (frozen v1 contract section).

Files
-----
  schema.sql          MySQL table (run once against the directory database)
  common.php          shared helpers (required by both endpoints)
  update_users.php    POST publish/update endpoint
  user_hints.php      GET search/exact-lookup endpoint
  config.example.php  copy to config.php, fill in MySQL credentials
  test_endpoints.sh   curl smoke tests (./test_endpoints.sh <base-url>)

Deploy steps (raida11.cloudcoin.global)
---------------------------------------
1. mysql < schema.sql   (against the target database)
2. Copy config.example.php to config.php next to the endpoint files and
   fill in credentials. Keep config.php out of version control and, if
   possible, outside the web root with an adjusted require path.
3. Upload the PHP files. The web server executes extensionless files as
   PHP, so publish them at:
       /update_users   (content of update_users.php)
       /user_hints     (content of user_hints.php)
   common.php and config.php must sit in the same directory (they are
   require'd relatively). If the server maps /update_users -> a .php file
   via rewrite rules instead, keep the .php names as-is.
4. Verify: ./test_endpoints.sh https://raida11.cloudcoin.global
   (or the staging base URL first).

Security status (v1)
--------------------
- The `auth` field in update_users is RESERVED but not validated: anyone
  can overwrite any profile. An ownership-proof protocol must land before
  this is treated as trustworthy public data (plan divergence D1).
- CORS is Access-Control-Allow-Origin: * by design (public read data,
  Electron/dev-server clients with varying origins).
- Add web-server-level rate limiting if available (e.g. nginx
  limit_req/limit_conn); the PHP layer enforces size and result caps only.
