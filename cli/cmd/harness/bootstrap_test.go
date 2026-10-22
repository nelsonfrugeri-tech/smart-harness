package main

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestBootstrapVerifiesChecksumAndLogsInFromFinalPath(t *testing.T) {
	template, err := os.ReadFile("../../install.sh")
	if err != nil {
		t.Fatal(err)
	}
	for _, valid := range []bool{false, true} {
		t.Run(fmt.Sprintf("checksum-valid-%v", valid), func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			bin := filepath.Join(root, "bin")
			assets := filepath.Join(root, "assets")
			target := filepath.Join(root, "installed with spaces")
			for _, dir := range []string{bin, assets, target} {
				if err := os.MkdirAll(dir, 0o700); err != nil {
					t.Fatal(err)
				}
			}
			write := func(path, body string) {
				t.Helper()
				if err := os.WriteFile(path, []byte(body), 0o700); err != nil {
					t.Fatal(err)
				}
			}
			write(filepath.Join(bin, "claude"), "#!/bin/sh\nexit 0\n")
			write(filepath.Join(bin, "curl"), `#!/bin/sh
output=
name=
while [ "$#" -gt 0 ]; do
 case "$1" in
  -o) shift; output=$1 ;;
  https://fixture.invalid/install/*) name=${1##*/} ;;
 esac
 shift
done
[ -n "$name" ] && [ -n "$output" ] || exit 91
/bin/cp "$TEST_ASSETS/$name" "$output"
`)
			binary := `#!/bin/sh
[ "${SMART_HARNESS_TOKEN+present}" != present ] || exit 92
[ "$1" = login ] && [ "$2" = --api-url ] && [ "$3" = https://fixture.invalid ] || exit 93
printf '%s\n' "$0" >> "$TEST_LOGIN_RECORD"
`
			asset := "harness-v0.2.1-" + runtime.GOOS + "-" + runtime.GOARCH
			write(filepath.Join(assets, asset), binary)
			hash := fmt.Sprintf("%x", sha256.Sum256([]byte(binary)))
			if !valid {
				hash = strings.Repeat("0", 64)
			}
			write(filepath.Join(assets, "SHA256SUMS"), hash+"  "+asset+"\n")
			final := filepath.Join(target, "harness")
			write(final, "previous installation\n")
			script := strings.ReplaceAll(strings.ReplaceAll(string(template), "@@API_URL_SHELL@@", "'https://fixture.invalid'"), "@@VERSION_SHELL@@", "'v0.2.1'")
			scriptPath := filepath.Join(root, "install.sh")
			write(scriptPath, script)
			t.Setenv("PATH", bin+":"+target+":"+os.Getenv("PATH"))
			t.Setenv("HARNESS_INSTALL_DIR", target)
			t.Setenv("TEST_ASSETS", assets)
			record := filepath.Join(root, "login-record")
			t.Setenv("TEST_LOGIN_RECORD", record)
			t.Setenv("SMART_HARNESS_TOKEN", "FAKE_CANARY_ONLY")
			output, err := exec.Command("/bin/sh", scriptPath).CombinedOutput()
			if !valid {
				if err == nil || !strings.Contains(string(output), "SHA256 verification failed") {
					t.Fatal(err, string(output))
				}
				content, _ := os.ReadFile(final)
				if string(content) != "previous installation\n" {
					t.Fatal("checksum failure overwrote installation")
				}
				if _, err := os.Stat(record); !os.IsNotExist(err) {
					t.Fatal("login ran before verification")
				}
				return
			}
			if err != nil {
				t.Fatal(err, string(output))
			}
			if _, err := exec.Command("/bin/sh", scriptPath).CombinedOutput(); err != nil {
				t.Fatal(err)
			}
			logged, _ := os.ReadFile(record)
			if string(logged) != final+"\n"+final+"\n" {
				t.Fatalf("login was not invoked from final path: %q", logged)
			}
			info, err := os.Stat(final)
			if err != nil || info.Mode().Perm() != 0o755 {
				t.Fatal(info, err)
			}
		})
	}
}
