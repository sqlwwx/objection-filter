push-master-dist:
	npm run build
	mv dist /tmp/
	cp package.json /tmp/package.json
	git checkout master-dist
	rm -rf dist
	rm -rf package.json
	mv /tmp/dist .
	mv /tmp/package.json .
	git diff origin/master-dist
	@read -p "push? [y/n]" yn; \
		case $$yn in \
		  [Yy]* ) git add .; git commit -m '$(shell date +%FT%T%Z) update'; git push;; \
			[Nn]* ) exit;; \
			* ) echo "Please answer yes or no.";; \
		esac

.PHONY: merge-test merge-master
