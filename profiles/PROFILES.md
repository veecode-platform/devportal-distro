# PROFILES

This folder contains `app-config.*.yaml` profiles that will be used based on the VEECODE_PROFILE environment variable. These profiles are added to those already provided by the base image.

- `app-config.github-pat.yaml` - Guest authentication + GitHub PAT integration
- `app-config.ldap-ad.yaml` - LDAP authentication and org sync tuned for Active Directory (Samba AD, Windows AD): uses `sAMAccountName` and AD object classes instead of the OpenLDAP-style `uid` / `inetOrgPerson` defaults
