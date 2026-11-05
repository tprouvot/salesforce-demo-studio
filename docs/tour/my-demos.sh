#!/bin/sh
# The starting point of a chapter of the tour, in /tmp/my-demos (each take starts from it):
#   empty     an empty folder
#   project   a project (sfdemo init) with an empty demos/hello.md
#   hello     a project with the hello demo written
#   recorded  the same, with the hello demo recorded (kept when it is there already)
set -e
here=$(cd "$(dirname "$0")" && pwd)
dir=/tmp/my-demos
fresh() { rm -rf "$dir"; mkdir -p "$dir"; }
project() { fresh; (cd "$dir" && sfdemo init --org myOrg --example none > /dev/null); }
case "$1" in
  empty) fresh ;;
  project) project; : > "$dir/demos/hello.md" ;;
  hello) project; cp "$here/hello.md" "$dir/demos/hello.md" ;;
  recorded)
    if [ ! -f "$dir/.local/recordings/hello/hello.mp4" ]; then
      project; cp "$here/hello.md" "$dir/demos/hello.md"
      (cd "$dir" && sfdemo demo demos/hello.md > /dev/null)
    fi ;;
  *) echo "usage: sh my-demos.sh empty|project|hello|recorded" >&2; exit 2 ;;
esac
