import json
from datetime import datetime

from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    is_beginner = db.Column(db.Boolean, nullable=True) # Null until survey is completed

    projects = db.relationship('Project', backref='user', lazy='dynamic',
                               cascade='all, delete-orphan')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "username": self.username,
            "is_beginner": self.is_beginner
        }


class Project(db.Model):
    __tablename__ = 'projects'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'),
                        nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    arch_type = db.Column(db.String(40), nullable=False)
    # JSON-encoded configuration
    layer_sizes = db.Column(db.String(200), nullable=False)
    epochs = db.Column(db.Integer, nullable=False)
    lr = db.Column(db.Float, nullable=False)
    batch_size = db.Column(db.Integer, nullable=False)
    optimizer = db.Column(db.String(40), nullable=False)
    activation = db.Column(db.String(40), nullable=False)
    early_stopping = db.Column(db.String(200), nullable=True)  # JSON
    # Outcome
    task_type = db.Column(db.String(20), nullable=False)  # classification / regression
    input_dim = db.Column(db.Integer, nullable=True)
    output_dim = db.Column(db.Integer, nullable=True)
    final_train_loss = db.Column(db.Float, nullable=True)
    final_val_loss = db.Column(db.Float, nullable=True)
    final_val_acc = db.Column(db.Float, nullable=True)
    early_stopped = db.Column(db.Boolean, nullable=False, default=False)
    stopped_epoch = db.Column(db.Integer, nullable=True)
    history = db.Column(db.Text, nullable=True)  # JSON-encoded list of per-epoch dicts
    weight_filename = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self, include_history=False):
        d = {
            "id": self.id,
            "name": self.name,
            "arch_type": self.arch_type,
            "layer_sizes": json.loads(self.layer_sizes),
            "epochs": self.epochs,
            "lr": self.lr,
            "batch_size": self.batch_size,
            "optimizer": self.optimizer,
            "activation": self.activation,
            "early_stopping": json.loads(self.early_stopping) if self.early_stopping else None,
            "task_type": self.task_type,
            "input_dim": self.input_dim,
            "output_dim": self.output_dim,
            "final_train_loss": self.final_train_loss,
            "final_val_loss": self.final_val_loss,
            "final_val_acc": self.final_val_acc,
            "early_stopped": self.early_stopped,
            "stopped_epoch": self.stopped_epoch,
            "weight_filename": self.weight_filename,
            "created_at": self.created_at.isoformat() + "Z",
        }
        if include_history and self.history:
            d["history"] = json.loads(self.history)
        return d
