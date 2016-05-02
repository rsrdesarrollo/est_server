/*
 module imports
 */
const express = require('express');
const async = require('async');

const CAControllerCfssl = require('../controllers/ca_controller_cfssl');
const RAControllerMongo = require('../controllers/ra_controller_mongo');
const pkcs10_decoder = require('../middleware/pkcs10');
const policy = require('../policies/policy');

/*
 CA and RA Controller
 */
const ca = new CAControllerCfssl();
const ra = new RAControllerMongo();

const router = express.Router();

/*
 CONSTANTS
 */
const OPTIONAL_LABEL_REGX = '(/:ca_lable)?';

/*
 Aux Functions
 */

/**
 *  Send a certificate response from a CAController to the client in pkcs7 format
 */
function response_pkcs7(res, err, result) {
    if (err) {
        throw err;
    }

    res.set('Content-Type', 'application/pkcs7-mime');
    res.set('Content-Transfer-Encoding', 'base64');
    res.send(result.certificate);
}

function response_retry_after(res, err, timeout) {
    if (err) {
        throw err;
    }

    res.status(202);
    res.set('Retry-After', timeout);
    res.send();
}

function response_forbidden(res, err, msg) {
    if (err) {
        throw err;
    }

    res.status(403);
    res.send(msg);
}

/*
 GET Routes
 */
router.get(OPTIONAL_LABEL_REGX + '/cacerts', function (req, res) {
    var ca_label = req.param('ca_lable');
    ca.get_ca_certificate(ca_label, response_pkcs7.bind(null, res));
});

/*
 POST Routes
 */
router.post(OPTIONAL_LABEL_REGX + '/simpleenroll',
    pkcs10_decoder,
    policy.authenticate('basic', {session: false}),
    function (req, res) {
        var ca_lable = req.param('ca_lable');
        var user = req.user;
        var client_ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        if (user.is_admin) {
            ca.sign_csr(ca_lable, req.csrRaw, response_pkcs7.bind(null, res));
        } else if (user.groups.indexOf("bootstrap") > -1) {
            async.waterfall([
                ra.get_registered_csr.bind(ra, req.csr),
                function (reg_csr, cb) {
                    if (!reg_csr) {
                        ra.register_csr(user, client_ip, req.csr, function (err) {
                            cb(err, {try_later: true});
                        });
                    } else if (reg_csr.is_removed) {
                        cb(null, null);
                    } else if (reg_csr.is_approved) {
                        ca.sign_csr(ca_lable, req.csrRaw, cb);
                    } else {
                        cb(null, {try_later: true});
                    }
                }
            ], function (err, result) {
                if (result.certificate) {
                    ra.delete_csr(req.csr, function (err) {
                        if (err) throw err;
                    });

                    response_pkcs7(res, err, result);
                } else if (result.try_later) {
                    response_retry_after(res, err, 600);
                } else {
                    response_forbidden(res, err, "Forbidden");
                }
            });
        }
    }
);

router.post(OPTIONAL_LABEL_REGX + '/simplereenroll', pkcs10_decoder, function (req, res) {
    console.log(req.param('ca_lable'));
    res.render('index', {title: 'Express'});
});


module.exports = router;
