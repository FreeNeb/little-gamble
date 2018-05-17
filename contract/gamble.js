"use strict";

// 资金
var Stake = function(json) {
    if (!!json) {
        let o = JSON.parse(json);
        this.balance  = new BigNumber(o.balance);
    } else {
        this.balance = new BigNumber(0);
    }
}
Stake.prototype.toString = function() {
    return JSON.stringify(this);
}

// 对赌局
var Gambling = function(json) {
    if (!!json) {
        let o = JSON.parse(json);
        this.owner = o.owner;
        this.id = o.id;
        this.smaller = (o.smaller);
        this.money = new BigNumber(o.money);
        // ‘ongoing': 等待参与； 'cancel': 已取消；'failed': 被参与者猜中; 'success': 参与者猜错
        this.state = o.state || 'ongoing'; 
        // 参与者的钱包id
        this.guesser = o.guesser || "";
    }
    else {
        this.owner = '';
        this.id = 0;
        this.smaller = false;
        this.money = new BigNumber(0);
        this.state = 'ongoing';
        this.guesser = "";
    }
}
Gambling.prototype.toString = function() {
    return JSON.stringify(this);
}

var GamblingContract = function () {
	LocalContractStorage.defineMapProperty(this, "stakes", {
		parse: function (text) {
			return new Stake(text);
		},
		stringify: function (o) {
			return o.toString();
		}
	});
	LocalContractStorage.defineMapProperty(this, "gamblings", {
		parse: function (text) {
			return new Gambling(text);
		},
		stringify: function (o) {
			return o.toString();
		}
    });
    LocalContractStorage.defineProperty(this, "gamberNum", null);
};

// save value to contract, only after height of block, users can takeout
GamblingContract.prototype = {
	init: function () {
        this.gamberNum = 0;
	},

	save: function (height) {
		var from = Blockchain.transaction.from;
		var value = Blockchain.transaction.value;

		var orig_stake = this.stakes.get(from);
		if (orig_stake) {
			value = value.plus(orig_stake.balance);
		}

		var stake = new Stake();
		stake.balance = value;

		this.stakes.put(from, stake);
	},

	takeout: function (value) {
		var from = Blockchain.transaction.from;
		var amount = new BigNumber(value);

		var stake = this.stakes.get(from);
		if (!stake) {
			throw new Error("No recharge before!");
		}

		if (amount.gt(stake.balance)) {
			throw new Error("Insufficient balance.");
		}

		var result = Blockchain.transfer(from, amount);
		if (!result) {
			throw new Error("transfer failed.");
		}
		Event.Trigger("TakeOut", {
			Transfer: {
				from: Blockchain.transaction.to,
				to: from,
				value: amount.toString()
			}
		});

		stake.balance = stake.balance.sub(amount);
		this.stakes.put(from, stake);
	},

	balanceOf: function () {
		var from = Blockchain.transaction.from;
		return this.stakes.get(from);
	},

	verifyAddress: function (address) {
		// 1-valid, 0-invalid
		var result = Blockchain.verifyAddress(address);
		return {
			valid: result == 0 ? false : true
		};
    },
    
    /**
     * 创建赌局，传入数值[3,18]
     */
    createGambling: function(point) {
        var owner = Blockchain.transaction.from;
        var money = Blockchain.transaction.value;

        var gambling = new Gambling();
        gambling.money = new BigNumber(money);
        // var stake = this.stakes.get(owner);
        if (point < 3 || point > 18) {
            throw new Error("point should be in the rang of [3, 18]!");
        }
        if (gambling.money.lt(new BigNumber(0))) {
            throw new Error("stake should not less than 0!");
        }
        /*
        if (gambling.money.gt(stake.balance)) {
            throw new Error("stake shold not bigger than your balance!");
        }
        */
        gambling.owner = owner + '';
        gambling.smaller = (point >= 3 && point < 10);
        gambling.id = this.gamberNum;

        // stake.balance = stake.balance.sub(gambling.money);
        // this.stakes.put(owner, stake);
        this.gamblings.put((this.gamberNum++) + '', gambling);
        return gambling;
    },

    /**
     * 取消赌局, 传入赌局的id
     */
    cancelGambling: function(number) {
        var owner = Blockchain.transaction.from;
        var gambling = this.gamblings.get(number + '');
        // var stake = this.stakes.get(owner);
        if (!!gambling && gambling.owner == owner && gambling.state == 'ongoing') {
            gambling.state = 'cancel';
            // stake.balance = stake.balance.plus(gambling.money);
            var result = Blockchain.transfer(owner, gambling.money);
            if (!result) {
                throw new Error("transfer failed.");
            }
            Event.Trigger("TakeOut", {
                Transfer: {
                    from: Blockchain.transaction.to,
                    to: owner,
                    value: gambling.money.toString()
                }
            });
            // this.stakes.put(owner, stake);
            this.gamblings.put(number+'', gambling);
        }
        var o = {id: gambling.id, owner: gambling.owner, money: gambling.money, state: gambling.state, guesser: gambling.guesser};
        return o;
    },

    /**
     * 参与赌局；传入赌局id和数值[3,18]
     */
    guess: function(number, point) {
        var guesser = Blockchain.transaction.from;
        var gambling = this.gamblings.get(number+'');
        var owner = gambling.owner;
        // var stake = this.stakes.get(guesser);
        // var ownerStake = this.stakes.get(gambling.owner);
        var cost = new BigNumber(Blockchain.transaction.value);
        if (!gambling) {
            throw new Error("The gambling is not valid!");
        }
        if (gambling.owner == guesser) {
            throw new Error("Should not gambling with self!");
        }
        if (cost.lt(gambling.money)) {
            throw new Error("Your cost is less than the stake!");
        }
        if (gambling.state != "ongoing") {
            throw new Error("The gambling is canceled or finished!");
        }
        var smaller = (point >= 3 && point <10);
        var result =  {guess: gambling.state, point: gambling.smaller}
        gambling.guesser = guesser;
        if (smaller == gambling.smaller) {
            var transResult = Blockchain.transfer(guesser, gambling.money.plus(cost));
            if (!transResult) {
                throw new Error("transfer failed.");
            }
            Event.Trigger("TakeOut", {
                Transfer: {
                    from: Blockchain.transaction.to,
                    to: guesser,
                    value: gambling.money.plus(cost).toString()
                }
            });
            // stake.balance = stake.balance.plus(gambling.money);
            gambling.state = 'failed';
            result.guess = 'success';
        } else {
            var transResult = Blockchain.transfer(owner, gambling.money.plus(cost));
            if (!transResult) {
                throw new Error("transfer failed.");
            }
            Event.Trigger("TakeOut", {
                Transfer: {
                    from: Blockchain.transaction.to,
                    to: owner,
                    value: gambling.money.plus(cost).toString()
                }
            });
            // ownerStake.balance = ownerStake.balance.plus(gambling.money).plus(gambling.money);
            gambling.state = 'success';
            result.guess = 'success';
            // stake.balance = stake.balance.sub(gambling.money);
        }
        // this.stakes.put(guesser, stake);
        // this.stakes.put(gambling.owner, ownerStake);
        this.gamblings.put(number+'', gambling);

        return result;
    }, 

    gamblingNumber: function() {
        return this.gamberNum;
    },

    /**
     * 查询赌局列表
     * ower：赌局发起者
     * state： 赌局状态 ('ongoing' || 'cancel' || 'failed' || 'success')
     * 不传参数时返回所有赌局列表
     */
    getGamblings: function(owner, state) {
        var result = [];
        for (var i = 0; i < this.gamberNum; ++i) {
            var gambling = this.gamblings.get(i+'');
            if (!!owner && owner != gambling.owner) {
               gambling = null; 
            }
            if (!!gambling && !!state && state != gambling.state) {
                gambling = null;
            }
            if (!!gambling) {
                var o = {id: gambling.id, owner: gambling.owner, money: gambling.money, state: gambling.state, guesser: gambling.guesser};
                if (gambling.state == 'failed' || gambling.state == 'success') {
                    o.smaller = gambling.smaller;
                }
                result.push(o);
            }
        }
        return result;
    }
};

module.exports = GamblingContract;