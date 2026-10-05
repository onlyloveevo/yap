#!/bin/zsh
# Stop YAP: double-click this file. It stops only the server this folder
# started. Setup checks that the saved process answers as YAP from this folder
# before it signals anything, so another program is never stopped.
exec /bin/zsh "${0:A:h}/Start YAP.command" --stop
