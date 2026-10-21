package main

import (
	"os"
	"os/signal"
	"sync"
	"syscall"
)

// exit is os.Exit. Tests replace it.
var exit = os.Exit

// Go exits on Ctrl-C without running deferred calls, which would leave the terminal without echo
// and the lock file in place. atInterrupt registers what to undo in that case.
var interrupt struct {
	sync.Mutex
	once     sync.Once
	next     int
	cleanups []cleanup
}

type cleanup struct {
	id  int
	run func()
}

// atInterrupt registers f to run on SIGINT or SIGTERM, newest first, before the process exits with
// 130. The returned function unregisters f; call it when f is no longer needed.
func atInterrupt(f func()) (remove func()) {
	interrupt.once.Do(func() {
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
		go func() {
			for range signals {
				runCleanups()
				exit(130)
			}
		}()
	})
	interrupt.Lock()
	defer interrupt.Unlock()
	interrupt.next++
	id := interrupt.next
	interrupt.cleanups = append(interrupt.cleanups, cleanup{id: id, run: f})
	return func() {
		interrupt.Lock()
		defer interrupt.Unlock()
		for i, c := range interrupt.cleanups {
			if c.id == id {
				interrupt.cleanups = append(interrupt.cleanups[:i], interrupt.cleanups[i+1:]...)
				return
			}
		}
	}
}

func runCleanups() {
	interrupt.Lock()
	pending := append([]cleanup(nil), interrupt.cleanups...)
	interrupt.Unlock()
	for i := len(pending) - 1; i >= 0; i-- {
		pending[i].run()
	}
}
